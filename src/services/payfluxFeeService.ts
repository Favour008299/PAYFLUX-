import { parseEther, formatEther } from 'viem';
import { PAYFLUX_PLATFORM_FEE_POL, PAYFLUX_PLATFORM_FEE_DISPLAY, PAYFLUX_TREASURY_ADDRESS } from '../config/platform';
import { safeGetAddress, polygonRpcClient } from './sharedSwapEngine';
import {
  sendTransactionWithRetry,
  getActiveWalletProvider,
  triggerMobileWalletPrompt,
  getConnectedWalletBrand,
  executeWalletTransaction,
  safeFormatError,
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
          errorMessage: `Insufficient POL balance for PayFlux platform fee. At least ${(requiredFee + estimatedGasBuffer).toFixed(4)} POL is required on Polygon to cover the 0.1 POL fee and network gas. (Current POL balance: ${currentPolBalance.toFixed(4)} POL)`,
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
 * Standalone fee transactions are disabled by platform policy.
 * Platform fees are executed atomically within the same transaction as the swap or payment
 * via PayFluxAtomicRouter (one wallet confirmation only).
 */
export async function executeAndVerifyPlatformFee(params?: any): Promise<FeeExecutionResult> {
  console.warn('[PayFlux Fee Service] Standalone fee transactions are disabled. Platform fees must be handled atomically in ONE wallet confirmation via PayFluxAtomicRouter.');
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
    error: 'Standalone fee transactions are disabled. Use PayFluxAtomicRouter for atomic single-confirmation execution.',
  };
}
