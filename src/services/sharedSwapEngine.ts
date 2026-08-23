/**
 * Unified Shared Swap Engine
 * Used across the entire PayFlux platform for both:
 * 1. Dedicated Swap Page (general decentralized asset swaps)
 * 2. Customer Checkout & Merchant Payments (fiat/token checkout conversions)
 */

import { getAddress, parseUnits, formatUnits, encodeFunctionData, parseAbi } from 'viem';
import { fetchDeBridgeQuote, DeBridgeQuoteResult } from './deBridgeService';
import { getLiveTokenPrices } from './livePricing';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const NATIVE_TOKEN_KYBER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

// Verified Routers
export const QUICKSWAP_POLYGON_ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff' as const;
export const UNISWAP_V2_ETH_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as const;
export const KYBERSWAP_POLYGON_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' as const;

// Wrapped native tokens
export const WPOL_POLYGON = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' as const;
export const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;

// Standard ABI definitions
export const ERC20_STANDARD_ABI = parseAbi([
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address recipient, uint256 amount) external returns (bool)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
]);

export const DEX_ROUTER_V2_ABI = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
]);

/**
 * Safely format an address to strict EIP-55 checksum format without throwing on case mismatch
 */
export function safeGetAddress(address?: string | null): `0x${string}` {
  if (!address || typeof address !== 'string') return ZERO_ADDRESS;
  const clean = address.trim();
  if (!clean.startsWith('0x') || clean.length !== 42) return ZERO_ADDRESS;
  try {
    return getAddress(clean.toLowerCase());
  } catch {
    return ZERO_ADDRESS;
  }
}

/**
 * Determine if a token address refers to the native gas asset (POL on Polygon, ETH on Ethereum)
 */
export function isNativeAddress(address?: string | null): boolean {
  if (!address) return true;
  const clean = address.toLowerCase().trim();
  return (
    clean === ZERO_ADDRESS ||
    clean === '0x0000000000000000000000000000000000001010' ||
    clean === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
    clean === ''
  );
}

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
  routingProtocol: 'KyberSwap DEX' | 'deBridge DLN' | 'QuickSwap DEX' | 'Verse DEX' | 'Uniswap DEX';
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

function normalizeAggregatorAddress(address: string): string {
  if (!address || isNativeAddress(address)) {
    return NATIVE_TOKEN_KYBER;
  }
  return safeGetAddress(address);
}

/**
 * Unified Swap Quote Resolution Engine
 */
export async function getUnifiedSwapQuote(params: SwapRouteParams): Promise<SwapRouteQuote> {
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
    userAddress,
    slippagePercent = 0.5,
  } = params;

  const numAmount = parseFloat(srcAmount);
  if (!srcAmount || isNaN(numAmount) || numAmount <= 0) {
    return {
      success: false,
      isCrossChain: false,
      routingProtocol: 'QuickSwap DEX',
      amountIn: '0',
      amountOut: '0',
      formattedAmountOut: '0',
      priceImpact: 0,
      estimatedGasUsd: 0,
      errorMessage: 'Please enter a valid swap amount',
    };
  }

  const cleanUserAddr = userAddress && safeGetAddress(userAddress) !== ZERO_ADDRESS
    ? safeGetAddress(userAddress)
    : '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

  const isCrossChain = srcChainId !== dstChainId;

  // ================= 1. CROSS-CHAIN ROUTING (deBridge DLN) =================
  if (isCrossChain) {
    try {
      const deBridgeRes = await fetchDeBridgeQuote({
        srcChainId,
        srcTokenAddress: isNativeAddress(srcTokenAddress) ? ZERO_ADDRESS : safeGetAddress(srcTokenAddress),
        srcDecimals,
        srcAmount,
        dstChainId,
        dstTokenAddress: isNativeAddress(dstTokenAddress) ? ZERO_ADDRESS : safeGetAddress(dstTokenAddress),
        dstDecimals,
        userAddress: cleanUserAddr,
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
      }
    } catch (e: any) {
      console.warn('[SharedSwapEngine] deBridge routing notice:', e);
    }
  }

  // ================= 2. SAME-CHAIN ROUTING (Polygon or Ethereum) =================
  const chainName = srcChainId === 137 ? 'polygon' : 'ethereum';
  const kyberIn = normalizeAggregatorAddress(srcTokenAddress);
  const kyberOut = normalizeAggregatorAddress(dstTokenAddress);

  let rawAmountInUnits: string;
  try {
    rawAmountInUnits = parseUnits(srcAmount, srcDecimals).toString();
  } catch {
    rawAmountInUnits = (
      BigInt(Math.floor(numAmount * 10 ** Math.min(srcDecimals, 6))) *
      BigInt(10 ** Math.max(0, srcDecimals - 6))
    ).toString();
  }

  // A. Try KyberSwap Aggregator first
  try {
    const quoteUrl = `https://aggregator-api.kyberswap.com/${chainName}/api/v1/routes?tokenIn=${kyberIn}&tokenOut=${kyberOut}&amountIn=${rawAmountInUnits}&gasInclude=true`;
    const res = await fetch(quoteUrl, { signal: AbortSignal.timeout(5000) });

    if (res.ok) {
      const data = await res.json();
      if (data && data.code === 0 && data.data?.routeSummary) {
        const summary = data.data.routeSummary;
        const rawAmountOut = summary.amountOut;
        const formattedOutNum = parseFloat(formatUnits(BigInt(rawAmountOut), dstDecimals));
        const formattedOut =
          formattedOutNum > 100_000
            ? formattedOutNum.toFixed(2)
            : formattedOutNum > 1
            ? formattedOutNum.toFixed(4)
            : formattedOutNum.toFixed(6);

        const routerAddress = safeGetAddress(data.data.routerAddress || KYBERSWAP_POLYGON_ROUTER);
        const gasUsd = parseFloat(summary.gasUsd || '0.02');
        const priceImpact = Math.abs(parseFloat(summary.priceImpact || '0.05'));

        let txData = '';
        let txTo: string = routerAddress;
        const isNativeIn = isNativeAddress(srcTokenAddress);
        let txValue = isNativeIn ? rawAmountInUnits : '0';

        // Build executable transaction payload
        try {
          const slippageBps = Math.max(10, Math.min(5000, Math.round(slippagePercent * 100)));
          const buildRes = await fetch(`https://aggregator-api.kyberswap.com/${chainName}/api/v1/route/build`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              routeSummary: summary,
              sender: cleanUserAddr,
              recipient: cleanUserAddr,
              slippageTolerance: slippageBps,
            }),
          });

          if (buildRes.ok) {
            const buildData = await buildRes.json();
            if (buildData && buildData.code === 0 && buildData.data) {
              txData = buildData.data.data;
              txTo = safeGetAddress(buildData.data.routerAddress || routerAddress);
              txValue = isNativeIn ? (buildData.data.transactionValue || buildData.data.amountIn || rawAmountInUnits) : '0';
            }
          }
        } catch (buildErr) {
          console.warn('[SharedSwapEngine] Kyber build notice:', buildErr);
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
  } catch (kyberErr) {
    console.warn('[SharedSwapEngine] KyberSwap aggregator query notice:', kyberErr);
  }

  // B. Fallback to Direct DEX Router (QuickSwap on Polygon / Uniswap V2 on Ethereum)
  try {
    const isPolygon = srcChainId === 137;
    const routerAddress = isPolygon ? QUICKSWAP_POLYGON_ROUTER : UNISWAP_V2_ETH_ROUTER;
    const isSrcNative = isNativeAddress(srcTokenAddress);
    const isDstNative = isNativeAddress(dstTokenAddress);
    const wrappedNative = isPolygon ? WPOL_POLYGON : WETH_ETHEREUM;

    const tokenInAddr = isSrcNative ? wrappedNative : safeGetAddress(srcTokenAddress);
    const tokenOutAddr = isDstNative ? wrappedNative : safeGetAddress(dstTokenAddress);

    // Calculate approximate output from live market pricing
    const { prices } = await getLiveTokenPrices();
    const srcPrice = prices[srcSymbol.toUpperCase()]?.priceUsd || 0;
    const dstPrice = prices[dstSymbol.toUpperCase()]?.priceUsd || 0;

    if (srcPrice > 0 && dstPrice > 0) {
      const estimatedTotalOut = (numAmount * srcPrice) / dstPrice;
      const minAmountOutUnits = parseUnits(
        (estimatedTotalOut * (1 - slippagePercent / 100)).toFixed(dstDecimals > 6 ? 6 : dstDecimals),
        dstDecimals
      );
      const formattedOut =
        estimatedTotalOut > 100_000
          ? estimatedTotalOut.toFixed(2)
          : estimatedTotalOut > 1
          ? estimatedTotalOut.toFixed(4)
          : estimatedTotalOut.toFixed(6);

      const path = [tokenInAddr, tokenOutAddr];
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes
      const rawIn = BigInt(rawAmountInUnits);

      let txData = '';
      let txValue = '0';

      if (isSrcNative) {
        // Native -> Token (swapExactETHForTokens)
        txData = encodeFunctionData({
          abi: DEX_ROUTER_V2_ABI,
          functionName: 'swapExactETHForTokens',
          args: [minAmountOutUnits, path, cleanUserAddr, deadline],
        });
        txValue = rawAmountInUnits;
      } else if (isDstNative) {
        // Token -> Native (swapExactTokensForETH)
        txData = encodeFunctionData({
          abi: DEX_ROUTER_V2_ABI,
          functionName: 'swapExactTokensForETH',
          args: [rawIn, minAmountOutUnits, path, cleanUserAddr, deadline],
        });
      } else {
        // Token -> Token (swapExactTokensForTokens)
        txData = encodeFunctionData({
          abi: DEX_ROUTER_V2_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [rawIn, minAmountOutUnits, path, cleanUserAddr, deadline],
        });
      }

      return {
        success: true,
        isCrossChain: false,
        routingProtocol: isPolygon ? 'QuickSwap DEX' : 'Uniswap DEX',
        amountIn: srcAmount,
        amountOut: minAmountOutUnits.toString(),
        formattedAmountOut: formattedOut,
        priceImpact: 0.1,
        estimatedGasUsd: isPolygon ? 0.01 : 2.5,
        routerAddress,
        allowanceTarget: routerAddress,
        transactionTo: routerAddress,
        transactionData: txData,
        transactionValue: txValue,
      };
    }
  } catch (directDexErr: any) {
    console.warn('[SharedSwapEngine] Direct DEX route build notice:', directDexErr);
  }

  return {
    success: false,
    isCrossChain,
    routingProtocol: 'QuickSwap DEX',
    amountIn: srcAmount,
    amountOut: '0',
    formattedAmountOut: '0',
    priceImpact: 0,
    estimatedGasUsd: 0,
    errorMessage: 'Liquidity route temporarily unavailable for this pair/size',
  };
}
