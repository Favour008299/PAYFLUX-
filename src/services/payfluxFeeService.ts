import { parseEther, parseUnits, encodeFunctionData, formatUnits, formatEther } from 'viem';
import { PAYFLUX_PLATFORM_FEE_POL, PAYFLUX_PLATFORM_FEE_DISPLAY, PAYFLUX_TREASURY_ADDRESS } from '../config/platform';
import { safeGetAddress, isNativeAddress, ERC20_STANDARD_ABI, polygonRpcClient, ethereumRpcClient } from './sharedSwapEngine';
import { sendTransactionWithRetry } from './walletSigningService';

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
  explorerUrl?: string;
  error?: string;
}

// Track executed fee hashes to prevent duplicate charges on retry
const processedFeeHashes = new Set<string>();

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

function withTimeoutPromise<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Checks if a user has sufficient POL balance to cover the 0.1 POL platform fee and network gas
 */
export async function checkSufficientFeeBalance(params: {
  userAddress: string;
  fromTokenSymbol: string;
  fromAmount: string;
  userPolBalance?: number;
}): Promise<{ isSufficient: boolean; errorMessage?: string }> {
  const { userAddress, fromTokenSymbol, fromAmount, userPolBalance } = params;

  if (!userAddress || userAddress === '0x') {
    return { isSufficient: true };
  }

  try {
    let currentPolBalance = userPolBalance;
    if (currentPolBalance === undefined) {
      const rawBalance = await polygonRpcClient.getBalance({
        address: safeGetAddress(userAddress),
      });
      currentPolBalance = parseFloat(formatEther(rawBalance));
    }

    const requiredFee = PAYFLUX_PLATFORM_FEE_POL; // 0.1 POL
    const estimatedGasBuffer = 0.008; // ~0.008 POL dynamic buffer for transaction gas

    if (fromTokenSymbol === 'POL') {
      const swapAmount = parseFloat(fromAmount) || 0;
      const totalRequiredPol = swapAmount + requiredFee + estimatedGasBuffer;
      if (currentPolBalance < totalRequiredPol) {
        return {
          isSufficient: false,
          errorMessage: `Insufficient POL balance. You need at least ${(swapAmount + requiredFee + estimatedGasBuffer).toFixed(4)} POL to cover swap amount (${swapAmount} POL), the 0.1 POL PayFlux platform fee, and estimated network gas (~${estimatedGasBuffer} POL). (Current balance: ${currentPolBalance.toFixed(4)} POL)`,
        };
      }
    } else {
      const minRequiredPol = requiredFee + estimatedGasBuffer;
      if (currentPolBalance < minRequiredPol) {
        return {
          isSufficient: false,
          errorMessage: `Insufficient POL balance for PayFlux platform fee. At least ${(requiredFee + estimatedGasBuffer).toFixed(4)} POL is required to cover the 0.1 POL fee and network gas. (Current POL balance: ${currentPolBalance.toFixed(4)} POL)`,
        };
      }
    }

    return { isSufficient: true };
  } catch (err) {
    console.warn('[PayFlux Fee Service] Balance check notice:', err);
    return { isSufficient: true }; // Proceed to let wallet prompt if RPC check fails
  }
}

/**
 * Executes a genuine on-chain fee transfer of exactly 0.1 POL
 * to the PayFlux revenue wallet (0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD).
 * 
 * Verifies on-chain transaction receipt before marking the fee as confirmed.
 */
export async function executeAndVerifyPlatformFee(params: {
  payerAddress: string;
  chainId: number;
  tokenSymbol?: string;
  tokenContractAddress?: string;
  tokenDecimals?: number;
  tokenPriceUsd?: number;
  sendTransactionAsync?: (args: any) => Promise<`0x${string}`>;
  writeContractAsync?: (args: any) => Promise<`0x${string}`>;
  activeProvider?: any;
}): Promise<FeeExecutionResult> {
  const {
    payerAddress,
    chainId,
    sendTransactionAsync,
    activeProvider,
  } = params;

  const targetTreasury = safeGetAddress(PAYFLUX_TREASURY_ADDRESS);
  const targetRpcClient = polygonRpcClient; // Always verify on Polygon PoS for revenue wallet
  const explorerBase = 'https://polygonscan.com';
  const feeWei = parseEther('0.1'); // Fixed 0.1 POL

  console.log('[PayFlux Fee Service] Preparing genuine on-chain 0.1 POL fee transfer:', {
    treasuryRecipient: targetTreasury,
    feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
    feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
    payerAddress,
  });

  let feeTxHash: `0x${string}` | undefined;

  try {
    // 1. Transfer 0.1 native POL on Polygon to PayFlux Treasury Address
    if (sendTransactionAsync) {
      feeTxHash = await withTimeoutPromise(
        sendTransactionAsync({
          to: targetTreasury,
          value: feeWei,
          chainId: 137,
        }),
        60000,
        '0.1 POL platform fee confirmation timed out in wallet. Please check your wallet app.'
      );
    } else if (activeProvider) {
      feeTxHash = await sendTransactionWithRetry(
        activeProvider,
        {
          from: payerAddress,
          to: targetTreasury,
          value: '0x' + feeWei.toString(16),
        },
        60000,
        'PayFlux platform fee transfer timed out in wallet.'
      );
    } else {
      throw new Error('No active wallet provider available for fee collection.');
    }

    if (!feeTxHash) {
      return {
        success: false,
        feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
        feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
        feeTokenSymbol: 'POL',
        feeAmountToken: '0.1',
        feeNetwork: 'Polygon',
        feeRecipient: targetTreasury,
        feeStatus: 'uncollected',
        error: 'No fee transaction hash returned from wallet.',
      };
    }

    // Check duplicate prevention
    if (processedFeeHashes.has(feeTxHash.toLowerCase())) {
      console.log('[PayFlux Fee Service] Fee already confirmed for hash:', feeTxHash);
      return {
        success: true,
        feeTxHash,
        feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
        feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
        feeTokenSymbol: 'POL',
        feeAmountToken: '0.1',
        feeNetwork: 'Polygon',
        feeRecipient: targetTreasury,
        feeStatus: 'confirmed',
        explorerUrl: `${explorerBase}/tx/${feeTxHash}`,
      };
    }

    console.log('[PayFlux Fee Service] 0.1 POL fee transaction submitted on-chain:', {
      feeTxHash,
      explorerUrl: `${explorerBase}/tx/${feeTxHash}`,
    });

    // 2. Strict On-Chain Block Receipt Verification with timeout
    const receipt = await withTimeoutPromise(
      targetRpcClient.waitForTransactionReceipt({
        hash: feeTxHash,
        timeout: 60000,
      }),
      60000,
      '0.1 POL platform fee blockchain confirmation timed out.'
    );

    if (receipt && (receipt.status === 'success' || (receipt as any).status === 1)) {
      processedFeeHashes.add(feeTxHash.toLowerCase());
      console.log('[PayFlux Fee Service] 0.1 POL fee transfer verified on-chain in block:', receipt.blockNumber);
      return {
        success: true,
        feeTxHash,
        feeBlockNumber: Number(receipt.blockNumber),
        feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
        feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
        feeTokenSymbol: 'POL',
        feeAmountToken: '0.1',
        feeNetwork: 'Polygon',
        feeRecipient: targetTreasury,
        feeStatus: 'confirmed',
        feeAmountUsd: 0.10, // legacy fallback
        explorerUrl: `${explorerBase}/tx/${feeTxHash}`,
      };
    } else {
      console.warn('[PayFlux Fee Service] Fee transaction reverted on blockchain:', feeTxHash);
      return {
        success: false,
        feeTxHash,
        feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
        feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
        feeTokenSymbol: 'POL',
        feeAmountToken: '0.1',
        feeNetwork: 'Polygon',
        feeRecipient: targetTreasury,
        feeStatus: 'failed',
        error: 'Fee transaction reverted on-chain.',
      };
    }
  } catch (err: any) {
    console.warn('[PayFlux Fee Service] Fee collection notice:', err?.message || err);
    return {
      success: false,
      feeTxHash,
      feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
      feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
      feeTokenSymbol: 'POL',
      feeAmountToken: '0.1',
      feeNetwork: 'Polygon',
      feeRecipient: targetTreasury,
      feeStatus: 'failed',
      error: err?.message || 'PayFlux 0.1 POL platform fee could not be collected.',
    };
  }
}
