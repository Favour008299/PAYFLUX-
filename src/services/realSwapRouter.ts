/**
 * Unified Real On-Chain Swap Router
 * Handles:
 * 1. Single-chain DEX swaps on Polygon (e.g. VERSE Polygon -> POL Polygon) via KyberSwap DEX Aggregator.
 * 2. Single-chain DEX swaps on Ethereum (e.g. VERSE Ethereum -> ETH Ethereum) via KyberSwap DEX Aggregator.
 * 3. Cross-chain swaps (e.g. Polygon -> Ethereum, Ethereum -> Polygon) via deBridge DLN protocol.
 */

import { parseUnits, formatUnits } from 'viem';
import { fetchDeBridgeQuote, DeBridgeQuoteResult } from './deBridgeService';

export interface SwapRouteParams {
  srcChainId: number; // 137 for Polygon, 1 for Ethereum
  srcTokenAddress: string;
  srcDecimals: number;
  srcSymbol: string;
  srcAmount: string;

  dstChainId: number;
  dstTokenAddress: string;
  dstDecimals: number;
  dstSymbol: string;

  userAddress?: string;
  slippagePercent?: number; // e.g. 0.5
}

export interface SwapRouteQuote {
  success: boolean;
  isCrossChain: boolean;
  routingProtocol: 'KyberSwap DEX' | 'deBridge DLN' | 'Verse DEX';
  amountIn: string;
  amountOut: string;
  formattedAmountOut: string;
  priceImpact: number;
  estimatedGasUsd: number;
  routerAddress?: string;
  allowanceTarget?: string;
  transactionData?: string;
  transactionTo?: string;
  transactionValue?: string;
  rawResponse?: any;
  errorMessage?: string;
}

const NATIVE_TOKEN_KYBER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function normalizeKyberAddress(address: string): string {
  if (!address || address === ZERO_ADDRESS || address.toLowerCase() === NATIVE_TOKEN_KYBER.toLowerCase()) {
    return NATIVE_TOKEN_KYBER;
  }
  return address;
}

/**
 * Get unified real swap quote
 */
export async function getRealSwapQuote(params: SwapRouteParams): Promise<SwapRouteQuote> {
  const {
    srcChainId,
    srcTokenAddress,
    srcDecimals,
    srcSymbol,
    srcAmount,
    dstChainId,
    dstTokenAddress,
    dstDecimals,
    dstSymbol,
    userAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    slippagePercent = 0.5,
  } = params;

  const numAmount = parseFloat(srcAmount);
  if (!srcAmount || isNaN(numAmount) || numAmount <= 0) {
    return {
      success: false,
      isCrossChain: false,
      routingProtocol: 'KyberSwap DEX',
      amountIn: '0',
      amountOut: '0',
      formattedAmountOut: '0',
      priceImpact: 0,
      estimatedGasUsd: 0,
      errorMessage: 'Invalid amount',
    };
  }

  // Check if cross-chain (Polygon <-> Ethereum)
  const isCrossChain = srcChainId !== dstChainId;

  if (isCrossChain) {
    // Route through deBridge DLN
    try {
      const deBridgeRes = await fetchDeBridgeQuote({
        srcChainId,
        srcTokenAddress,
        srcDecimals,
        srcAmount,
        dstChainId,
        dstTokenAddress,
        dstDecimals,
        userAddress,
        slippagePercent,
      });

      if (deBridgeRes.success) {
        return {
          success: true,
          isCrossChain: true,
          routingProtocol: 'deBridge DLN',
          amountIn: srcAmount,
          amountOut: deBridgeRes.estimatedAmountOut,
          formattedAmountOut: deBridgeRes.formattedAmountOut,
          priceImpact: typeof deBridgeRes.recommendedSlippage === 'number'
            ? deBridgeRes.recommendedSlippage
            : parseFloat(String(deBridgeRes.recommendedSlippage || 0.1)) || 0.1,
          estimatedGasUsd: typeof deBridgeRes.estimatedOperatingExpenseUsd === 'number'
            ? deBridgeRes.estimatedOperatingExpenseUsd
            : parseFloat(String(deBridgeRes.estimatedOperatingExpenseUsd || 0.5)) || 0.5,
          allowanceTarget: deBridgeRes.tx?.allowanceTarget || deBridgeRes.tx?.to,
          transactionTo: deBridgeRes.tx?.to,
          transactionData: deBridgeRes.tx?.data,
          transactionValue: deBridgeRes.tx?.value,
          rawResponse: deBridgeRes,
        };
      } else {
        return {
          success: false,
          isCrossChain: true,
          routingProtocol: 'deBridge DLN',
          amountIn: srcAmount,
          amountOut: '0',
          formattedAmountOut: '0',
          priceImpact: 0,
          estimatedGasUsd: 0,
          errorMessage: deBridgeRes.errorMessage || 'Cross-chain liquidity unavailable',
        };
      }
    } catch (e: any) {
      console.warn('[RealSwapRouter] deBridge error:', e);
      return {
        success: false,
        isCrossChain: true,
        routingProtocol: 'deBridge DLN',
        amountIn: srcAmount,
        amountOut: '0',
        formattedAmountOut: '0',
        priceImpact: 0,
        estimatedGasUsd: 0,
        errorMessage: e.message || 'Cross-chain quote failed',
      };
    }
  }

  // Same-chain Swap (Polygon or Ethereum)
  const chainName = srcChainId === 137 ? 'polygon' : 'ethereum';
  const kyberIn = normalizeKyberAddress(srcTokenAddress);
  const kyberOut = normalizeKyberAddress(dstTokenAddress);

  try {
    let rawAmountInUnits: string;
    try {
      rawAmountInUnits = parseUnits(srcAmount, srcDecimals).toString();
    } catch {
      rawAmountInUnits = (BigInt(Math.floor(numAmount * 10 ** Math.min(srcDecimals, 6))) * BigInt(10 ** Math.max(0, srcDecimals - 6))).toString();
    }

    // 1. Fetch KyberSwap route quote
    const quoteUrl = `https://aggregator-api.kyberswap.com/${chainName}/api/v1/routes?tokenIn=${kyberIn}&tokenOut=${kyberOut}&amountIn=${rawAmountInUnits}&gasInclude=true`;
    const res = await fetch(quoteUrl, { signal: AbortSignal.timeout(6000) });

    if (res.ok) {
      const data = await res.json();
      if (data && data.code === 0 && data.data?.routeSummary) {
        const summary = data.data.routeSummary;
        const rawAmountOut = summary.amountOut;
        const formattedOutNum = parseFloat(formatUnits(BigInt(rawAmountOut), dstDecimals));
        const formattedOut = formattedOutNum > 100_000 ? formattedOutNum.toFixed(2) : formattedOutNum.toFixed(6);

        const routerAddress = data.data.routerAddress;
        const gasUsd = parseFloat(summary.gasUsd || '0.02');
        const priceImpact = Math.abs(parseFloat(summary.priceImpact || '0.05'));

        // 2. Build executable transaction if userAddress is provided
        let txData = '';
        let txTo = routerAddress;
        const isNativeInput = kyberIn === NATIVE_TOKEN_KYBER;
        let txValue = isNativeInput ? rawAmountInUnits : '0';

        if (userAddress && userAddress !== ZERO_ADDRESS) {
          try {
            const slippageBps = Math.max(10, Math.min(5000, Math.round(slippagePercent * 100))); // e.g. 50 = 0.5%, min 0.1%
            const buildRes = await fetch(`https://aggregator-api.kyberswap.com/${chainName}/api/v1/route/build`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                routeSummary: summary,
                sender: userAddress,
                recipient: userAddress,
                slippageTolerance: slippageBps,
              }),
            });

            if (buildRes.ok) {
              const buildData = await buildRes.json();
              if (buildData && buildData.code === 0 && buildData.data) {
                txData = buildData.data.data;
                txTo = buildData.data.routerAddress || routerAddress;
                // If input token is native currency (POL/ETH), the transaction must send msg.value = rawAmountInUnits
                txValue = isNativeInput ? (buildData.data.amountIn || rawAmountInUnits) : '0';
              }
            }
          } catch (buildErr) {
            console.warn('[RealSwapRouter] KyberSwap build route notice:', buildErr);
          }
        }

        return {
          success: true,
          isCrossChain: false,
          routingProtocol: 'KyberSwap DEX',
          amountIn: srcAmount,
          amountOut: rawAmountOut,
          formattedAmountOut: formattedOut,
          priceImpact,
          estimatedGasUsd: gasUsd,
          routerAddress,
          allowanceTarget: routerAddress,
          transactionTo: txTo,
          transactionData: txData,
          transactionValue: txValue,
          rawResponse: data,
        };
      }
    }
  } catch (err) {
    console.warn('[RealSwapRouter] KyberSwap routing error:', err);
  }

  // Fallback if aggregator temporarily unreachable
  return {
    success: false,
    isCrossChain: false,
    routingProtocol: 'KyberSwap DEX',
    amountIn: srcAmount,
    amountOut: '0',
    formattedAmountOut: '0',
    priceImpact: 0,
    estimatedGasUsd: 0,
    errorMessage: 'No direct liquidity route found for this pair.',
  };
}
