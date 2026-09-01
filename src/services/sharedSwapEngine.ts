/**
 * Unified Shared Swap Engine
 * Used across the entire PayFlux platform for both:
 * 1. Dedicated Swap Page (general decentralized asset swaps)
 * 2. Customer Checkout & Merchant Payments (fiat/token checkout conversions)
 */

import {
  getAddress,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  parseAbi,
  createPublicClient,
  http,
  fallback,
} from 'viem';
import { polygon, mainnet } from 'viem/chains';
import { fetchDeBridgeQuote, DeBridgeQuoteResult } from './deBridgeService';
import { getLiveTokenPrices } from './livePricing';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const NATIVE_TOKEN_KYBER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

// Verified On-Chain Routers
export const QUICKSWAP_POLYGON_ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff' as const;
export const UNISWAP_V2_ETH_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as const;
export const KYBERSWAP_POLYGON_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' as const;

// Verified Tokens & Intermediary Assets
export const WPOL_POLYGON = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' as const;
export const VERSE_POLYGON = '0xc708D6F2153933DAA50B2D0758955Be0A93A8FEc' as const;
export const USDT_POLYGON = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as const;
export const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as const;
export const USDC_BRIDGED_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as const;
export const DAI_POLYGON = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063' as const;
export const WBTC_POLYGON = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6' as const;

export const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
export const VERSE_ETHEREUM = '0x249cA82617eC3DfB2589c4c17ab7EC9765350a18' as const;
export const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const;
export const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
export const DAI_ETHEREUM = '0x6B175474E89094C44Da98b954EedeAC495271d0F' as const;

// Resilient Public RPC Clients for On-Chain Router Queries
export const polygonRpcClient = createPublicClient({
  chain: polygon,
  transport: fallback([
    http('https://polygon-bor-rpc.publicnode.com'),
    http('https://polygon.drpc.org'),
    http('https://1rpc.io/matic'),
    http('https://polygon.gateway.tenderly.co'),
  ]),
});

export const ethereumRpcClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http('https://ethereum-rpc.publicnode.com'),
    http('https://eth.drpc.org'),
    http('https://1rpc.io/eth'),
  ]),
});

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
  recipientAddress?: string;
  slippagePercent?: number; // e.g. 0.5
}

export interface SwapRouteQuote {
  success: boolean;
  isCrossChain: boolean;
  routingProtocol: 'KyberSwap DEX' | 'deBridge DLN' | 'QuickSwap DEX' | 'Uniswap DEX' | 'KyberSwap Aggregator' | 'Uniswap Aggregator' | string;
  orderId?: string;
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
    recipientAddress,
    slippagePercent = 0.5,
  } = params;

  // 1. Validate Chain IDs
  if (!srcChainId || (srcChainId !== 137 && srcChainId !== 1)) {
    return {
      success: false,
      isCrossChain: false,
      routingProtocol: 'QuickSwap DEX',
      amountIn: srcAmount || '0',
      amountOut: '0',
      formattedAmountOut: '0',
      priceImpact: 0,
      estimatedGasUsd: 0,
      errorMessage: `Unsupported source network (Chain ID: ${srcChainId})`,
    };
  }

  if (!dstChainId || (dstChainId !== 137 && dstChainId !== 1)) {
    return {
      success: false,
      isCrossChain: false,
      routingProtocol: 'QuickSwap DEX',
      amountIn: srcAmount || '0',
      amountOut: '0',
      formattedAmountOut: '0',
      priceImpact: 0,
      estimatedGasUsd: 0,
      errorMessage: `Unsupported destination network (Chain ID: ${dstChainId})`,
    };
  }

  // 2. Validate Amount
  const numAmount = parseFloat(srcAmount);
  if (!srcAmount || isNaN(numAmount) || numAmount <= 0) {
    return {
      success: false,
      isCrossChain: srcChainId !== dstChainId,
      routingProtocol: srcChainId === 137 ? 'QuickSwap DEX' : 'Uniswap DEX',
      amountIn: '0',
      amountOut: '0',
      formattedAmountOut: '0',
      priceImpact: 0,
      estimatedGasUsd: 0,
      errorMessage: 'Please enter a valid swap amount',
    };
  }

  // 3. Validate Token Decimals
  const safeSrcDecimals = typeof srcDecimals === 'number' && !isNaN(srcDecimals) && srcDecimals >= 0 ? srcDecimals : 18;
  const safeDstDecimals = typeof dstDecimals === 'number' && !isNaN(dstDecimals) && dstDecimals >= 0 ? dstDecimals : 18;

  // 4. Validate Token Addresses
  const cleanSrcTokenAddr = srcTokenAddress || ZERO_ADDRESS;
  const cleanDstTokenAddr = dstTokenAddress || ZERO_ADDRESS;

  const cleanUserAddr = userAddress && safeGetAddress(userAddress) !== ZERO_ADDRESS
    ? safeGetAddress(userAddress)
    : '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

  const cleanRecipientAddr = recipientAddress && safeGetAddress(recipientAddress) !== ZERO_ADDRESS
    ? safeGetAddress(recipientAddress)
    : cleanUserAddr;

  let rawAmountInUnits: string;
  try {
    rawAmountInUnits = parseUnits(srcAmount, safeSrcDecimals).toString();
  } catch {
    rawAmountInUnits = (
      BigInt(Math.floor(numAmount * 10 ** Math.min(safeSrcDecimals, 6))) *
      BigInt(10 ** Math.max(0, safeSrcDecimals - 6))
    ).toString();
  }

  const isCrossChain = srcChainId !== dstChainId;

  // Structured verification and logging of all outbound swap parameters
  console.log('[PayFlux Swap Engine] Evaluating swap parameters:', {
    sourceChainId: srcChainId,
    destinationChainId: dstChainId,
    sourceTokenContractAddress: srcTokenAddress,
    destinationTokenContractAddress: dstTokenAddress,
    sourceDecimals: srcDecimals,
    destinationDecimals: dstDecimals,
    sourceSymbol: srcSymbol,
    destinationSymbol: dstSymbol,
    inputAmount: srcAmount,
    inputAmountSmallestUnits: rawAmountInUnits,
    connectedWalletAddress: cleanUserAddr,
    recipientAddress: cleanRecipientAddr,
    slippagePercent,
    isCrossChain,
    swapProvider: isCrossChain
      ? 'deBridge DLN Cross-Chain Infrastructure'
      : (srcChainId === 137 ? 'QuickSwap V2 DEX Router' : 'Uniswap V2 DEX Router'),
    apiEndpoint: isCrossChain
      ? 'https://api.dln.trade/v1.0/dln/order/create-tx'
      : (srcChainId === 137 ? 'Polygon QuickSwap Router: 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff' : 'Ethereum Uniswap V2 Router: 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'),
  });

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
        recipientAddress: cleanRecipientAddr,
        slippagePercent,
      });

      if (deBridgeRes.success && deBridgeRes.tx?.data && deBridgeRes.tx?.to) {
        return {
          success: true,
          isCrossChain: true,
          routingProtocol: 'deBridge DLN',
          orderId: deBridgeRes.orderId,
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
          transactionTo: safeGetAddress(deBridgeRes.tx?.to),
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
          errorMessage: 'Swap unavailable — no route found for this token pair or amount.',
        };
      }
    } catch (e: any) {
      console.warn('[SharedSwapEngine] deBridge routing notice:', e);
      return {
        success: false,
        isCrossChain: true,
        routingProtocol: 'deBridge DLN',
        amountIn: srcAmount,
        amountOut: '0',
        formattedAmountOut: '0',
        priceImpact: 0,
        estimatedGasUsd: 0,
        errorMessage: 'Swap unavailable — no route found for this token pair or amount.',
      };
    }
  }

  // ================= 2. SAME-CHAIN ROUTING (Polygon / Ethereum) =================
  const isPolygon = srcChainId === 137;
  const isSrcNative = isNativeAddress(srcTokenAddress);
  const isDstNative = isNativeAddress(dstTokenAddress);
  const wrappedNative = isPolygon ? WPOL_POLYGON : WETH_ETHEREUM;

  // Step A: Primary Aggregator Routing (KyberSwap Aggregator multi-DEX routes across Uniswap V3, QuickSwap V2/V3, SushiSwap, Curve, etc.)
  try {
    const chainName = isPolygon ? 'polygon' : 'ethereum';
    const kyberIn = normalizeAggregatorAddress(srcTokenAddress);
    const kyberOut = normalizeAggregatorAddress(dstTokenAddress);
    const quoteUrl = `https://aggregator-api.kyberswap.com/${chainName}/api/v1/routes?tokenIn=${kyberIn}&tokenOut=${kyberOut}&amountIn=${rawAmountInUnits}&gasInclude=true`;
    const kyberHeaders = {
      'Accept': 'application/json',
      'x-client-id': 'PayFlux-DEX',
    };
    const res = await fetch(quoteUrl, {
      headers: kyberHeaders,
      signal: AbortSignal.timeout(12000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.code === 0 && data.data?.routeSummary) {
        const summary = data.data.routeSummary;
        const rawAmountOut = summary.amountOut;
        const formattedOutNum = parseFloat(formatUnits(BigInt(rawAmountOut), dstDecimals));
        const formattedOut =
          formattedOutNum > 100_000
            ? formattedOutNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : formattedOutNum > 1
            ? formattedOutNum.toFixed(4)
            : formattedOutNum.toFixed(6);

        const routerAddress = safeGetAddress(data.data.routerAddress || (isPolygon ? KYBERSWAP_POLYGON_ROUTER : UNISWAP_V2_ETH_ROUTER));
        const gasUsd = parseFloat(summary.gasUsd || '0.01');
        const priceImpact = Math.abs(parseFloat(summary.priceImpact || '0.05'));

        const slippageBps = Math.max(50, Math.min(5000, Math.round(slippagePercent * 100)));
        const buildRes = await fetch(`https://aggregator-api.kyberswap.com/${chainName}/api/v1/route/build`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-client-id': 'PayFlux-DEX',
          },
          body: JSON.stringify({
            routeSummary: summary,
            sender: cleanUserAddr,
            recipient: cleanRecipientAddr,
            slippageTolerance: slippageBps,
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (buildRes.ok) {
          const buildData = await buildRes.json();
          if (
            buildData &&
            buildData.code === 0 &&
            buildData.data &&
            typeof buildData.data.data === 'string' &&
            buildData.data.data.startsWith('0x') &&
            buildData.data.data.length > 10
          ) {
            const txData = buildData.data.data;
            const txTo = safeGetAddress(buildData.data.routerAddress || routerAddress);
            const txValue = isSrcNative
              ? (buildData.data.transactionValue || buildData.data.amountIn || rawAmountInUnits)
              : '0';

            return {
              success: true,
              isCrossChain: false,
              routingProtocol: isPolygon ? 'KyberSwap Aggregator' : 'Uniswap Aggregator',
              amountIn: srcAmount,
              amountOut: rawAmountOut,
              formattedAmountOut: formattedOut,
              priceImpact,
              estimatedGasUsd: gasUsd,
              routerAddress: txTo,
              allowanceTarget: txTo,
              transactionTo: txTo,
              transactionData: txData,
              transactionValue: txValue,
              rawResponse: data,
            };
          }
        }
      }
    }
  } catch (kyberErr) {
    console.warn('[SharedSwapEngine] KyberSwap aggregator query notice, evaluating fallback router:', kyberErr);
  }

  // Step B: Fallback On-Chain DEX Router Routing (Direct Pool Reserve Math)
  const routerAddress = isPolygon ? QUICKSWAP_POLYGON_ROUTER : UNISWAP_V2_ETH_ROUTER;
  const rpcClient = isPolygon ? polygonRpcClient : ethereumRpcClient;

  const rawInAddr = isSrcNative ? wrappedNative : safeGetAddress(srcTokenAddress);
  const rawOutAddr = isDstNative ? wrappedNative : safeGetAddress(dstTokenAddress);

  const intermediaryUsdc = isPolygon ? USDC_POLYGON : USDC_ETHEREUM;
  const intermediaryUsdcBridged = isPolygon ? USDC_BRIDGED_POLYGON : USDC_ETHEREUM;
  const intermediaryUsdt = isPolygon ? USDT_POLYGON : USDT_ETHEREUM;
  const verseAddr = isPolygon ? VERSE_POLYGON : VERSE_ETHEREUM;
  const daiAddr = isPolygon ? DAI_POLYGON : DAI_ETHEREUM;

  const candidatePaths: Array<`0x${string}`[]> = [
    [rawInAddr, rawOutAddr],
    [rawInAddr, wrappedNative, rawOutAddr],
    [rawInAddr, intermediaryUsdcBridged, rawOutAddr],
    [rawInAddr, intermediaryUsdt, rawOutAddr],
    [rawInAddr, intermediaryUsdc, rawOutAddr],
    [rawInAddr, verseAddr, rawOutAddr],
    [rawInAddr, daiAddr, rawOutAddr],
    [rawInAddr, wrappedNative, intermediaryUsdcBridged, rawOutAddr],
    [rawInAddr, wrappedNative, intermediaryUsdt, rawOutAddr],
    [rawInAddr, wrappedNative, intermediaryUsdc, rawOutAddr],
    [rawInAddr, wrappedNative, verseAddr, rawOutAddr],
    [rawInAddr, verseAddr, wrappedNative, rawOutAddr],
    [rawInAddr, intermediaryUsdt, wrappedNative, rawOutAddr],
    [rawInAddr, intermediaryUsdcBridged, wrappedNative, rawOutAddr],
  ]
    .map((path) =>
      path.filter((addr, idx, arr) => idx === 0 || addr.toLowerCase() !== arr[idx - 1].toLowerCase())
    )
    .filter((path) => path.length >= 2);

  let bestAmountOutBigInt = 0n;
  let bestPath: `0x${string}`[] | null = null;
  const amountInBigInt = BigInt(rawAmountInUnits);

  const pathResults = await Promise.allSettled(
    candidatePaths.map(async (path) => {
      try {
        const amounts = (await (rpcClient as any).readContract({
          address: routerAddress,
          abi: DEX_ROUTER_V2_ABI,
          functionName: 'getAmountsOut',
          args: [amountInBigInt, path],
        })) as bigint[];

        if (amounts && amounts.length >= path.length) {
          const out = amounts[amounts.length - 1];
          return { path, amountOut: out };
        }
      } catch {
        // Path does not exist or has zero liquidity
      }
      return null;
    })
  );

  for (const res of pathResults) {
    if (res.status === 'fulfilled' && res.value && res.value.amountOut > bestAmountOutBigInt) {
      bestAmountOutBigInt = res.value.amountOut;
      bestPath = res.value.path;
    }
  }

  if (bestPath && bestAmountOutBigInt > 0n) {
    // 2% default safe slippage tolerance for fallback direct pools
    const safeSlippagePct = Math.max(1.5, slippagePercent);
    const slippageFactor = Math.max(1, Math.floor((100 - safeSlippagePct) * 100));
    const minAmountOutUnits = (bestAmountOutBigInt * BigInt(slippageFactor)) / 10000n;

    const formattedOutNum = parseFloat(formatUnits(bestAmountOutBigInt, dstDecimals));
    const formattedOut =
      formattedOutNum > 100_000
        ? formattedOutNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : formattedOutNum > 1
        ? formattedOutNum.toFixed(4)
        : formattedOutNum.toFixed(6);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 mins deadline
    let txData = '';
    let txValue = '0';

    if (isSrcNative) {
      txData = encodeFunctionData({
        abi: DEX_ROUTER_V2_ABI,
        functionName: 'swapExactETHForTokens',
        args: [minAmountOutUnits, bestPath, cleanRecipientAddr, deadline],
      });
      txValue = rawAmountInUnits;
    } else if (isDstNative) {
      txData = encodeFunctionData({
        abi: DEX_ROUTER_V2_ABI,
        functionName: 'swapExactTokensForETH',
        args: [amountInBigInt, minAmountOutUnits, bestPath, cleanRecipientAddr, deadline],
      });
    } else {
      txData = encodeFunctionData({
        abi: DEX_ROUTER_V2_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [amountInBigInt, minAmountOutUnits, bestPath, cleanRecipientAddr, deadline],
      });
    }

    return {
      success: true,
      isCrossChain: false,
      routingProtocol: isPolygon ? 'QuickSwap DEX' : 'Uniswap DEX',
      amountIn: srcAmount,
      amountOut: bestAmountOutBigInt.toString(),
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

  // ================= 3. NO EXECUTABLE ROUTE AVAILABLE =================
  return {
    success: false,
    isCrossChain,
    routingProtocol: isPolygon ? 'QuickSwap DEX' : 'Uniswap DEX',
    amountIn: srcAmount,
    amountOut: '0',
    formattedAmountOut: '0',
    priceImpact: 0,
    estimatedGasUsd: 0,
    errorMessage: 'Swap unavailable — no route found for this token pair or amount.',
  };
}

