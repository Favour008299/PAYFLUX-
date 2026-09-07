import { parseEther, formatEther } from 'viem';
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

export const PRIOR_COMPENSATED_FEE_TX = '0xb03e22879989dd0e363371ab1bff1071c55ec35b6aea507845b436971197b964';
export const PRIOR_COMPENSATED_WALLET = '0x3975c8755371B00B798747362a1346318b424b61';

export function isCompensatedPendingFee(_walletAddress?: string): boolean {
  // All swaps must execute atomic on-chain fee routing to 0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD
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
