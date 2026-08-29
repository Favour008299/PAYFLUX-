import { parseEther, parseUnits, encodeFunctionData, formatUnits, formatEther } from 'viem';
import { PAYFLUX_PLATFORM_FEE_USD, PAYFLUX_TREASURY_ADDRESS } from '../config/platform';
import { safeGetAddress, isNativeAddress, ERC20_STANDARD_ABI, polygonRpcClient, ethereumRpcClient } from './sharedSwapEngine';
import { sendTransactionWithRetry } from './walletSigningService';

export interface FeeExecutionResult {
  success: boolean;
  feeTxHash?: string;
  feeBlockNumber?: number;
  feeAmountUsd: number;
  feeTokenSymbol: string;
  feeAmountToken: string;
  feeRecipient: string;
  feeStatus: 'confirmed' | 'uncollected' | 'pending' | 'failed';
  explorerUrl?: string;
  error?: string;
}

/**
 * Calculates the exact fee token amount required for the $0.10 PayFlux fee
 */
export function calculatePlatformFeeAmount(
  tokenSymbol: string,
  priceUsd: number,
  network: 'polygon' | 'ethereum' | string,
  decimals: number = 18
): { feeAmountToken: string; feeAmountFormatted: string } {
  const isEth = network === 'ethereum';
  const defaultPrice = isEth ? 2500.0 : (tokenSymbol === 'POL' ? 0.40 : 1.0);
  const effectivePrice = priceUsd > 0 ? priceUsd : defaultPrice;
  const rawFeeAmount = PAYFLUX_PLATFORM_FEE_USD / effectivePrice;

  const maxDec = Math.min(decimals, 8);
  const feeAmountToken = rawFeeAmount < 0.000001
    ? rawFeeAmount.toExponential(4)
    : rawFeeAmount.toFixed(maxDec);

  const feeAmountFormatted = rawFeeAmount < 0.0001
    ? rawFeeAmount.toExponential(4)
    : rawFeeAmount.toFixed(rawFeeAmount > 100 ? 2 : 4);

  return { feeAmountToken, feeAmountFormatted };
}

/**
 * Executes a genuine on-chain fee transfer of the configured PayFlux platform fee
 * to the PayFlux revenue wallet (0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD).
 * 
 * Verifies on-chain transaction receipt before marking the fee as confirmed.
 */
export async function executeAndVerifyPlatformFee(params: {
  payerAddress: string;
  chainId: number;
  tokenSymbol: string;
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
    tokenSymbol,
    tokenContractAddress,
    tokenDecimals = 18,
    tokenPriceUsd = 0,
    sendTransactionAsync,
    writeContractAsync,
    activeProvider,
  } = params;

  const targetTreasury = safeGetAddress(PAYFLUX_TREASURY_ADDRESS);
  const isPolygon = chainId === 137;
  const targetRpcClient = isPolygon ? polygonRpcClient : ethereumRpcClient;
  const explorerBase = isPolygon ? 'https://polygonscan.com' : 'https://etherscan.io';
  const isNative = isNativeAddress(tokenContractAddress) || (isPolygon && tokenSymbol === 'POL') || (!isPolygon && tokenSymbol === 'ETH');

  const { feeAmountToken } = calculatePlatformFeeAmount(
    tokenSymbol,
    tokenPriceUsd,
    isPolygon ? 'polygon' : 'ethereum',
    tokenDecimals
  );

  console.log('[PayFlux Fee Service] Preparing genuine on-chain fee transfer:', {
    treasuryRecipient: targetTreasury,
    feeAmountUsd: PAYFLUX_PLATFORM_FEE_USD,
    tokenSymbol,
    feeAmountToken,
    chainId,
    payerAddress,
  });

  let feeTxHash: `0x${string}` | undefined;

  try {
    if (isNative) {
      // Native token transfer (POL on Polygon / ETH on Ethereum)
      const feeWei = parseEther(parseFloat(feeAmountToken).toFixed(8));

      if (sendTransactionAsync) {
        feeTxHash = await sendTransactionAsync({
          to: targetTreasury,
          value: feeWei,
          chainId,
        });
      } else if (activeProvider) {
        feeTxHash = await sendTransactionWithRetry(
          activeProvider,
          {
            from: payerAddress,
            to: targetTreasury,
            value: '0x' + feeWei.toString(16),
          },
          90000,
          'PayFlux platform fee transfer timed out in wallet.'
        );
      } else {
        throw new Error('No active wallet provider available for fee collection.');
      }
    } else {
      // ERC-20 token transfer (USDT, USDC, VERSE, etc.)
      const tokenAddr = safeGetAddress(tokenContractAddress);
      const safeDec = Math.min(tokenDecimals, 18);
      const feeUnits = parseUnits(parseFloat(feeAmountToken).toFixed(safeDec > 6 ? 6 : safeDec), safeDec);

      if (writeContractAsync) {
        feeTxHash = await (writeContractAsync as any)({
          address: tokenAddr,
          abi: ERC20_STANDARD_ABI,
          functionName: 'transfer',
          args: [targetTreasury, feeUnits],
          chainId,
        });
      } else if (activeProvider) {
        const transferCalldata = encodeFunctionData({
          abi: ERC20_STANDARD_ABI,
          functionName: 'transfer',
          args: [targetTreasury, feeUnits],
        });

        feeTxHash = await sendTransactionWithRetry(
          activeProvider,
          {
            from: payerAddress,
            to: tokenAddr,
            data: transferCalldata,
            value: '0x0',
          },
          90000,
          'PayFlux platform fee transfer timed out in wallet.'
        );
      } else {
        throw new Error('No active wallet provider available for fee collection.');
      }
    }

    if (!feeTxHash) {
      return {
        success: false,
        feeAmountUsd: 0,
        feeTokenSymbol: tokenSymbol,
        feeAmountToken,
        feeRecipient: targetTreasury,
        feeStatus: 'uncollected',
        error: 'No fee transaction hash returned from wallet.',
      };
    }

    console.log('[PayFlux Fee Service] Fee transaction submitted to blockchain:', {
      feeTxHash,
      explorerUrl: `${explorerBase}/tx/${feeTxHash}`,
    });

    // 2. Strict On-Chain Block Receipt Verification
    const receipt = await targetRpcClient.waitForTransactionReceipt({
      hash: feeTxHash,
      timeout: 60000,
    });

    if (receipt && (receipt.status === 'success' || (receipt as any).status === 1)) {
      console.log('[PayFlux Fee Service] Fee transfer successfully verified on-chain in block:', receipt.blockNumber);
      return {
        success: true,
        feeTxHash,
        feeBlockNumber: Number(receipt.blockNumber),
        feeAmountUsd: PAYFLUX_PLATFORM_FEE_USD,
        feeTokenSymbol: tokenSymbol,
        feeAmountToken,
        feeRecipient: targetTreasury,
        feeStatus: 'confirmed',
        explorerUrl: `${explorerBase}/tx/${feeTxHash}`,
      };
    } else {
      console.warn('[PayFlux Fee Service] Fee transaction reverted on blockchain:', feeTxHash);
      return {
        success: false,
        feeTxHash,
        feeAmountUsd: 0,
        feeTokenSymbol: tokenSymbol,
        feeAmountToken,
        feeRecipient: targetTreasury,
        feeStatus: 'uncollected',
        error: 'Fee transaction reverted on-chain.',
      };
    }
  } catch (err: any) {
    console.warn('[PayFlux Fee Service] Fee collection error:', err?.message || err);
    return {
      success: false,
      feeAmountUsd: 0,
      feeTokenSymbol: tokenSymbol,
      feeAmountToken,
      feeRecipient: targetTreasury,
      feeStatus: 'uncollected',
      error: err?.message || 'Platform fee could not be collected.',
    };
  }
}
