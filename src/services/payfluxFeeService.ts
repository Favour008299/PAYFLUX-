import { parseEther, formatEther, decodeEventLog, parseAbiItem, parseAbi, decodeFunctionData } from 'viem';
import { PAYFLUX_PLATFORM_FEE_POL, PAYFLUX_PLATFORM_FEE_DISPLAY, PAYFLUX_TREASURY_ADDRESS, PAYFLUX_PLATFORM_FEE_WEI } from '../config/platform';
import { safeGetAddress, polygonRpcClient } from './sharedSwapEngine';
import {
  executeWalletTransaction,
  safeFormatError,
  getConnectedWalletBrand,
} from './walletSigningService';

export interface FeeExecutionResult {
  success: boolean;
  feeTxHash?: string;
  feeBlockNumber?: number;
  feeAmountPol: number; // 0.1 POL
  feeDisplay: string; // "0.1 POL"
  feeTokenSymbol: string; // "POL"
  feeAmountToken: string; // "0.1"
  feeNetwork: string; // "Polygon"
  feeRecipient: string;
  feeStatus: 'confirmed' | 'uncollected' | 'pending' | 'failed';
  feeAmountUsd?: number; // legacy fallback
  feeTimestamp?: number;
  explorerUrl?: string;
  error?: string;
}

export const PRIOR_COMPENSATED_FEE_TX = '';
export const PRIOR_COMPENSATED_WALLET = '';

export function isCompensatedPendingFee(_walletAddress?: string): boolean {
  // Strictly enforce real on-chain confirmation only - never use fake or hardcoded transactions
  return false;
}

/**
 * Returns the exact fixed platform fee of 0.1 POL
 */
export function calculatePlatformFeeAmount(): {
  feeAmountToken: string;
  feeTokenSymbol: string;
  feeDisplay: string;
  feeAmountPol: number;
} {
  return {
    feeAmountToken: '0.1',
    feeTokenSymbol: 'POL',
    feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
    feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
  };
}

/**
 * Checks if a user has sufficient POL balance to cover the 0.1 POL platform fee and network gas
 */
export async function checkSufficientFeeBalance(params: {
  userAddress: string;
  fromTokenSymbol: string;
  fromAmount: string;
  userPolBalance?: number;
  isFeeDeductedFromOutput?: boolean;
  isFeeAlreadyPaid?: boolean;
}): Promise<{ isSufficient: boolean; errorMessage?: string; requiredPol: number; currentPol: number }> {
  const { userAddress, fromTokenSymbol, fromAmount, userPolBalance, isFeeDeductedFromOutput, isFeeAlreadyPaid } = params;

  if (!userAddress || userAddress === '0x') {
    return { isSufficient: true, requiredPol: 0.1, currentPol: 0 };
  }

  try {
    let currentPolBalance = userPolBalance;
    if (currentPolBalance === undefined || currentPolBalance === null) {
      const rawBalance = await polygonRpcClient.getBalance({
        address: safeGetAddress(userAddress),
      });
      currentPolBalance = parseFloat(formatEther(rawBalance));
    }

    const requiredFee = PAYFLUX_PLATFORM_FEE_POL; // 0.1 POL
    const estimatedGasBuffer = 0.015; // Gas buffer for transaction execution on Polygon

    if (fromTokenSymbol === 'POL') {
      const swapAmount = parseFloat(fromAmount) || 0;
      const totalRequiredPol = parseFloat((swapAmount + (isFeeAlreadyPaid ? 0 : requiredFee) + estimatedGasBuffer).toFixed(4));
      if (currentPolBalance < totalRequiredPol) {
        return {
          isSufficient: false,
          requiredPol: totalRequiredPol,
          currentPol: currentPolBalance,
          errorMessage: `Insufficient POL balance. You need at least ${totalRequiredPol.toFixed(4)} POL to cover swap amount (${swapAmount} POL)${isFeeAlreadyPaid ? '' : ', the 0.1 POL PayFlux platform fee,'} and Polygon network gas (~${estimatedGasBuffer} POL). Current balance: ${currentPolBalance.toFixed(4)} POL.`,
        };
      }
      return { isSufficient: true, requiredPol: totalRequiredPol, currentPol: currentPolBalance };
    } else {
      // Non-POL input (e.g. VERSE):
      // If the 0.1 POL fee is deducted from the POL output on-chain or was already paid,
      // the user only needs gas in their wallet to execute the swap.
      const feeNeedsWalletPol = !isFeeDeductedFromOutput && !isFeeAlreadyPaid;
      const minRequiredPol = parseFloat(((feeNeedsWalletPol ? requiredFee : 0) + estimatedGasBuffer).toFixed(4));
      if (currentPolBalance < minRequiredPol) {
        return {
          isSufficient: false,
          requiredPol: minRequiredPol,
          currentPol: currentPolBalance,
          errorMessage: `Insufficient POL balance for gas. At least ${minRequiredPol.toFixed(4)} POL is required on Polygon to cover network gas. Current balance: ${currentPolBalance.toFixed(4)} POL.`,
        };
      }
      return { isSufficient: true, requiredPol: minRequiredPol, currentPol: currentPolBalance };
    }
  } catch (err) {
    console.warn('[PayFlux Fee Service] Balance check notice:', err);
    return { isSufficient: true, requiredPol: 0.015, currentPol: 0 };
  }
}

/**
 * Transfers exactly 0.1 POL platform fee directly to PayFlux revenue wallet on Polygon
 * Revenue Wallet: 0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD
 */
export async function transferPlatformFeeToRevenueWallet(params: {
  account: `0x${string}`;
  connector?: any;
  provider?: any;
  sendTransactionAsync?: (args: any) => Promise<`0x${string}`>;
  onSubmitted?: (txHash: string) => void;
}): Promise<FeeExecutionResult> {
  const { account, connector, provider, sendTransactionAsync, onSubmitted } = params;
  const recipient = safeGetAddress(PAYFLUX_TREASURY_ADDRESS);
  const feeWei = PAYFLUX_PLATFORM_FEE_WEI; // Exactly 100000000000000000n wei (0.1 POL)

  try {
    const feeHash = await executeWalletTransaction({
      to: recipient,
      value: feeWei,
      data: '0x',
      account,
      chainId: 137, // Polygon Mainnet
      connector,
      provider,
      sendTransactionAsync,
      walletName: connector?.name,
      timeoutMs: 90000,
      promptMobileWallet: true,
    });

    if (onSubmitted) {
      onSubmitted(feeHash);
    }

    // Wait for on-chain receipt to guarantee confirmed transfer
    const receipt = await polygonRpcClient.waitForTransactionReceipt({
      hash: feeHash as `0x${string}`,
      timeout: 60000,
    });

    if (receipt.status === 'reverted') {
      return {
        success: false,
        feeTxHash: feeHash,
        feeBlockNumber: Number(receipt.blockNumber),
        feeAmountPol: 0,
        feeDisplay: '0 POL (Failed)',
        feeTokenSymbol: 'POL',
        feeAmountToken: '0',
        feeNetwork: 'Polygon',
        feeRecipient: recipient,
        feeStatus: 'failed',
        feeTimestamp: Date.now(),
        explorerUrl: `https://polygonscan.com/tx/${feeHash}`,
        error: `Fee transfer reverted on Polygon (Tx: ${feeHash})`,
      };
    }

    return {
      success: true,
      feeTxHash: feeHash,
      feeBlockNumber: Number(receipt.blockNumber),
      feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
      feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
      feeTokenSymbol: 'POL',
      feeAmountToken: '0.1',
      feeNetwork: 'Polygon',
      feeRecipient: recipient,
      feeStatus: 'confirmed',
      feeTimestamp: Date.now(),
      explorerUrl: `https://polygonscan.com/tx/${feeHash}`,
    };
  } catch (err: any) {
    const errMsg = safeFormatError(err);
    return {
      success: false,
      feeAmountPol: 0,
      feeDisplay: '0 POL (Failed)',
      feeTokenSymbol: 'POL',
      feeAmountToken: '0',
      feeNetwork: 'Polygon',
      feeRecipient: recipient,
      feeStatus: 'failed',
      feeTimestamp: Date.now(),
      error: errMsg,
    };
  }
}

export interface OnChainFeeVerificationResult {
  isVerified: boolean;
  method?: string;
  deliveredFeeWei?: bigint;
  feeRecipient?: string;
}

/**
 * Robust on-chain platform fee verification adhering to strict on-chain proofs:
 * 1. Direct transaction inspection (tx.to === revenueWallet && tx.value >= 100000000000000000n wei)
 * 2. Polygon Genesis MRC20 LogTransfer (0x0000000000000000000000000000000000001010) proving native POL transfer
 * 3. KyberSwap Router Fee event with recipient 0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD
 * 4. PayFlux Atomic Router contract events (FeeCollected, PaymentExecuted, AtomicSwapExecuted, AtomicPaymentExecuted)
 * 5. On-chain balance delta at transaction block number
 */
export async function verifyOnChainPlatformFee(params: {
  receipt: any;
  txHash: `0x${string}`;
  targetChainId?: number;
  revenueBalBefore?: bigint | null;
  walletAddress?: string;
}): Promise<OnChainFeeVerificationResult> {
  const { receipt, txHash, targetChainId, revenueBalBefore, walletAddress } = params;
  if (!receipt || (targetChainId !== undefined && targetChainId !== 137)) {
    return { isVerified: false };
  }

  const revenueWallet = safeGetAddress(PAYFLUX_TREASURY_ADDRESS).toLowerCase();
  const requiredFeeWei = PAYFLUX_PLATFORM_FEE_WEI; // Exactly 100000000000000000n wei (0.1 POL)

  // 1. Direct transaction inspection: tx.to === revenueWallet && tx.value >= 100000000000000000n
  try {
    const tx = await polygonRpcClient.getTransaction({ hash: txHash });
    if (tx && tx.to && tx.to.toLowerCase() === revenueWallet && tx.value >= requiredFeeWei) {
      return {
        isVerified: true,
        method: 'Direct On-Chain Transaction Value',
        deliveredFeeWei: tx.value,
        feeRecipient: PAYFLUX_TREASURY_ADDRESS,
      };
    }
  } catch (err) {
    console.warn('[PayFlux Fee Service] Direct tx check notice:', err);
  }

  // 1b. Multicall3 aggregate3Value atomic native fee transfer check
  try {
    const tx = await polygonRpcClient.getTransaction({ hash: txHash });
    if (
      tx &&
      tx.to &&
      tx.to.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11' &&
      tx.input &&
      tx.input.startsWith('0x1713f50a') &&
      receipt.status === 'success'
    ) {
      const multicallAbi = parseAbi([
        'struct Call3Value { address target; bool allowFailure; uint256 value; bytes callData; }',
        'struct Result { bool success; bytes returnData; }',
        'function aggregate3Value(Call3Value[] calldata calls) external payable returns (Result[] memory returnData)'
      ]);
      const decoded: any = decodeFunctionData({
        abi: multicallAbi,
        data: tx.input,
      });
      if (decoded && Array.isArray(decoded.args?.[0])) {
        const calls = decoded.args[0] as Array<{ target: string; allowFailure: boolean; value: bigint; callData: string }>;
        const feeCall = calls.find(
          (c) => c.target.toLowerCase() === revenueWallet && c.value >= requiredFeeWei && !c.allowFailure
        );
        if (feeCall) {
          return {
            isVerified: true,
            method: 'Multicall3 Confirmed On-Chain Native Fee',
            deliveredFeeWei: feeCall.value,
            feeRecipient: PAYFLUX_TREASURY_ADDRESS,
          };
        }
      }
    }
  } catch (mErr) {
    console.warn('[PayFlux Fee Service] Multicall3 inspection notice:', mErr);
  }

  // 2. Polygon MRC20 native POL transfer log emitted by Genesis system contract (0x0000000000000000000000000000000000001010)
  // Event: LogTransfer(address indexed token, address indexed from, address indexed to, uint256 amount, ...)
  // Topic 0: 0xe6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4
  if (receipt.logs && Array.isArray(receipt.logs)) {
    for (const rawLog of receipt.logs) {
      const log = rawLog as any;
      if (
        log.address &&
        log.address.toLowerCase() === '0x0000000000000000000000000000000000001010' &&
        log.topics &&
        log.topics[0] === '0xe6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4' &&
        log.topics[3]
      ) {
        const toAddress = ('0x' + log.topics[3].slice(26)).toLowerCase();
        if (toAddress === revenueWallet) {
          const amountHex = (log.data || '').slice(0, 66);
          if (amountHex) {
            try {
              const amount = BigInt(amountHex);
              if (amount >= requiredFeeWei) {
                return {
                  isVerified: true,
                  method: 'Polygon Native LogTransfer',
                  deliveredFeeWei: amount,
                  feeRecipient: PAYFLUX_TREASURY_ADDRESS,
                };
              }
            } catch {}
          }
        }
      }
    }
  }

  // 3. KyberSwap Router Fee event
  // event Fee(address token, uint256 totalAmount, uint256 totalFee, address[] recipients, uint256[] amounts, bool isBps)
  if (receipt.logs && Array.isArray(receipt.logs)) {
    for (const rawLog of receipt.logs) {
      const log = rawLog as any;
      try {
        if (log.topics && log.data) {
          const decoded: any = decodeEventLog({
            abi: [
              parseAbiItem(
                'event Fee(address token, uint256 totalAmount, uint256 totalFee, address[] recipients, uint256[] amounts, bool isBps)'
              ),
            ],
            data: log.data,
            topics: log.topics,
          });
          if (decoded?.eventName === 'Fee') {
            const args = decoded.args as { recipients: readonly string[]; amounts: readonly bigint[] };
            const matchIdx = args.recipients.findIndex(
              (r) => r.toLowerCase() === revenueWallet
            );
            if (matchIdx !== -1 && args.amounts[matchIdx] >= requiredFeeWei) {
              return {
                isVerified: true,
                method: 'KyberSwap On-Chain Fee Event',
                deliveredFeeWei: args.amounts[matchIdx],
                feeRecipient: PAYFLUX_TREASURY_ADDRESS,
              };
            }
          }
        }
      } catch {}
    }
  }

  // 4. PayFlux Atomic Router & Contract Fee Events
  if (receipt.logs && Array.isArray(receipt.logs)) {
    for (const rawLog of receipt.logs) {
      const log = rawLog as any;
      try {
        if (log.topics && log.data) {
          const decoded: any = decodeEventLog({
            abi: [
              parseAbiItem('event FeeCollected(address indexed payer, address indexed recipient, uint256 feeAmount, uint256 timestamp)'),
              parseAbiItem('event PaymentExecuted(address indexed payer, address indexed merchant, address indexed token, uint256 amount, uint256 feeAmount, uint256 timestamp)'),
              parseAbiItem('event AtomicSwapExecuted(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 feePol, address targetRouter)'),
              parseAbiItem('event AtomicPaymentExecuted(address indexed payer, address indexed merchant, address indexed token, uint256 amount, uint256 feePol)'),
            ],
            data: log.data,
            topics: log.topics,
          });
          if (decoded?.eventName === 'FeeCollected') {
            const args = decoded.args as { recipient: string; feeAmount: bigint };
            if (args.recipient.toLowerCase() === revenueWallet && args.feeAmount >= requiredFeeWei) {
              return {
                isVerified: true,
                method: 'PayFlux FeeCollected Event',
                deliveredFeeWei: args.feeAmount,
                feeRecipient: PAYFLUX_TREASURY_ADDRESS,
              };
            }
          }
          if (decoded?.eventName === 'PaymentExecuted') {
            const args = decoded.args as { feeAmount: bigint };
            if (args.feeAmount >= requiredFeeWei) {
              return {
                isVerified: true,
                method: 'PayFlux PaymentExecuted Event',
                deliveredFeeWei: args.feeAmount,
                feeRecipient: PAYFLUX_TREASURY_ADDRESS,
              };
            }
          }
          if (decoded?.eventName === 'AtomicSwapExecuted' || decoded?.eventName === 'AtomicPaymentExecuted') {
            const args = decoded.args as { feePol: bigint };
            if (args.feePol >= requiredFeeWei) {
              return {
                isVerified: true,
                method: 'PayFlux Atomic Event',
                deliveredFeeWei: args.feePol,
                feeRecipient: PAYFLUX_TREASURY_ADDRESS,
              };
            }
          }
        }
      } catch {}
    }
  }

  // 5. On-chain balance delta check at transaction block
  try {
    if (receipt.blockNumber) {
      const blockNum = BigInt(receipt.blockNumber);
      const balAtBlock = await polygonRpcClient.getBalance({
        address: safeGetAddress(PAYFLUX_TREASURY_ADDRESS),
        blockNumber: blockNum,
      });

      if (revenueBalBefore !== null && revenueBalBefore !== undefined) {
        if (balAtBlock >= revenueBalBefore + requiredFeeWei) {
          return {
            isVerified: true,
            method: 'Revenue Wallet Balance Delta',
            deliveredFeeWei: balAtBlock - revenueBalBefore,
            feeRecipient: PAYFLUX_TREASURY_ADDRESS,
          };
        }
      } else if (blockNum > 0n) {
        const balPrevBlock = await polygonRpcClient.getBalance({
          address: safeGetAddress(PAYFLUX_TREASURY_ADDRESS),
          blockNumber: blockNum - 1n,
        });
        if (balAtBlock >= balPrevBlock + requiredFeeWei) {
          return {
            isVerified: true,
            method: 'Revenue Wallet Block Balance Delta',
            deliveredFeeWei: balAtBlock - balPrevBlock,
            feeRecipient: PAYFLUX_TREASURY_ADDRESS,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[PayFlux Fee Service] Balance delta check notice:', err);
  }

  return { isVerified: false };
}

/**
 * Legacy compatibility wrapper
 */
export async function executeAndVerifyPlatformFee(params?: any): Promise<FeeExecutionResult> {
  if (params?.account) {
    return transferPlatformFeeToRevenueWallet(params);
  }
  return {
    success: false,
    feeAmountPol: 0,
    feeDisplay: '0 POL',
    feeTokenSymbol: 'POL',
    feeAmountToken: '0',
    feeNetwork: 'Polygon',
    feeRecipient: PAYFLUX_TREASURY_ADDRESS,
    feeStatus: 'failed',
    feeTimestamp: Date.now(),
    error: 'Missing account parameter for fee execution',
  };
}
