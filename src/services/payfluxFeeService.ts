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
 * Executes a genuine on-chain fee transfer of exactly 0.1 POL
 * to the configurable PayFlux treasury wallet address.
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
  connector?: any;
  walletName?: string;
  sendTransactionAsync?: (args: any) => Promise<`0x${string}`>;
  writeContractAsync?: (args: any) => Promise<`0x${string}`>;
  activeProvider?: any;
  promptMobileWallet?: boolean;
}): Promise<FeeExecutionResult> {
  const {
    payerAddress,
    chainId,
    connector,
    walletName,
    sendTransactionAsync,
    activeProvider,
    promptMobileWallet = true,
  } = params;

  const validPayer = safeGetAddress(payerAddress);
  const targetTreasury = safeGetAddress(PAYFLUX_TREASURY_ADDRESS);
  const targetRpcClient = polygonRpcClient; // Always verify on Polygon PoS for revenue wallet
  const explorerBase = 'https://polygonscan.com';
  const feeWei = parseEther('0.1'); // Fixed 0.1 POL

  if (!validPayer || validPayer === '0x0000000000000000000000000000000000000000') {
    return {
      success: false,
      feeAmountPol: 0,
      feeDisplay: '0 POL (Failed)',
      feeTokenSymbol: 'POL',
      feeAmountToken: '0',
      feeNetwork: 'Polygon',
      feeRecipient: targetTreasury,
      feeStatus: 'failed',
      feeTimestamp: Date.now(),
      error: 'Invalid or missing payer wallet address.',
    };
  }

  console.log('[PayFlux Fee Service] Preparing genuine on-chain 0.1 POL fee transfer:', {
    treasuryRecipient: targetTreasury,
    feeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
    feeAmountPol: PAYFLUX_PLATFORM_FEE_POL,
    payerAddress: validPayer,
  });

  const walletBrand = getConnectedWalletBrand(walletName || connector?.name);
  if (promptMobileWallet) {
    setTimeout(() => {
      triggerMobileWalletPrompt(walletBrand);
    }, 150);
  }

  let feeTxHash: `0x${string}` | undefined;

  try {
    // 1. Transfer 0.1 native POL on Polygon (Chain ID 137) to PayFlux Treasury Address
    feeTxHash = await executeWalletTransaction({
      to: targetTreasury,
      data: '0x',
      value: feeWei,
      account: validPayer,
      chainId: 137, // Always Polygon for the 0.1 POL platform fee
      connector,
      sendTransactionAsync,
      walletName: walletName || connector?.name,
      timeoutMs: 65000,
      promptMobileWallet,
      gas: 45000n,
    });

    if (!feeTxHash) {
      return {
        success: false,
        feeAmountPol: 0,
        feeDisplay: '0 POL (Failed)',
        feeTokenSymbol: 'POL',
        feeAmountToken: '0',
        feeNetwork: 'Polygon',
        feeRecipient: targetTreasury,
        feeStatus: 'failed',
        feeTimestamp: Date.now(),
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
        feeTimestamp: Date.now(),
        explorerUrl: `${explorerBase}/tx/${feeTxHash}`,
      };
    }

    console.log('[PayFlux Fee Service] 0.1 POL fee transaction submitted on-chain:', {
      feeTxHash,
      explorerUrl: `${explorerBase}/tx/${feeTxHash}`,
    });

    // 2. Strict On-Chain Block Receipt Verification with timeout
    let receipt: any = null;
    try {
      receipt = await withTimeoutPromise(
        targetRpcClient.waitForTransactionReceipt({
          hash: feeTxHash,
          timeout: 60000,
        }),
        60000,
        '0.1 POL platform fee blockchain confirmation timed out.'
      );
    } catch (waitErr: any) {
      console.warn('[PayFlux Fee Service] waitForTransactionReceipt notice, querying getTransactionReceipt directly:', waitErr);
      try {
        receipt = await targetRpcClient.getTransactionReceipt({ hash: feeTxHash });
      } catch (_) {}
      if (!receipt) throw waitErr;
    }

    if (receipt && (receipt.status === 'success' || (receipt as any).status === 1 || (receipt as any).status === '0x1')) {
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
        feeTimestamp: Date.now(),
        explorerUrl: `${explorerBase}/tx/${feeTxHash}`,
      };
    } else {
      console.warn('[PayFlux Fee Service] Fee transaction reverted on blockchain:', feeTxHash);
      return {
        success: false,
        feeTxHash,
        feeAmountPol: 0,
        feeDisplay: '0 POL (Failed)',
        feeTokenSymbol: 'POL',
        feeAmountToken: '0',
        feeNetwork: 'Polygon',
        feeRecipient: targetTreasury,
        feeStatus: 'failed',
        feeTimestamp: Date.now(),
        error: 'Fee transaction reverted on-chain.',
      };
    }
  } catch (err: any) {
    const rawErrMsg = safeFormatError(err);
    console.warn('[PayFlux Fee Service] Fee collection notice:', rawErrMsg);
    return {
      success: false,
      feeTxHash,
      feeAmountPol: 0,
      feeDisplay: '0 POL (Failed)',
      feeTokenSymbol: 'POL',
      feeAmountToken: '0',
      feeNetwork: 'Polygon',
      feeRecipient: targetTreasury,
      feeStatus: 'failed',
      feeTimestamp: Date.now(),
      error: rawErrMsg || 'PayFlux 0.1 POL platform fee could not be collected.',
    };
  }
}
