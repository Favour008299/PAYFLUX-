import { getAddress, parseUnits, formatUnits } from 'viem';
import { PAYFLUX_TREASURY_ADDRESS } from '../config/platform';

export interface DeBridgeQuoteParams {
  srcChainId: number;
  srcTokenAddress: string;
  srcDecimals: number;
  srcAmount: string;
  dstChainId: number;
  dstTokenAddress: string;
  dstDecimals: number;
  userAddress?: string;
  recipientAddress?: string;
  slippagePercent?: number;
}

export interface DeBridgeQuoteResult {
  success: boolean;
  orderId?: string;
  estimatedAmountOut: string;
  formattedAmountOut: string;
  approximateUsdValue: number;
  originApproximateUsdValue: number;
  fixFee: string;
  protocolFeeApproximateUsdValue: number;
  estimatedOperatingExpenseUsd: number;
  tx?: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    allowanceTarget?: `0x${string}`;
    allowanceValue?: string;
  };
  costsDetails?: Array<{
    type: string;
    chain: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
  }>;
  recommendedSlippage?: number;
  errorMessage?: string;
}

const DEBRIDGE_API_URL = 'https://api.dln.trade/v1.0/dln/order/create-tx';

export async function fetchDeBridgeQuote(params: DeBridgeQuoteParams): Promise<DeBridgeQuoteResult> {
  try {
    const {
      srcChainId,
      srcTokenAddress,
      srcDecimals,
      srcAmount,
      dstChainId,
      dstTokenAddress,
      dstDecimals,
      userAddress,
      recipientAddress,
      slippagePercent = 0.5,
    } = params;

    const numAmount = parseFloat(srcAmount);
    if (!srcAmount || isNaN(numAmount) || numAmount <= 0) {
      return {
        success: false,
        estimatedAmountOut: '0',
        formattedAmountOut: '0.00',
        approximateUsdValue: 0,
        originApproximateUsdValue: 0,
        fixFee: '0',
        protocolFeeApproximateUsdValue: 0,
        estimatedOperatingExpenseUsd: 0,
        errorMessage: 'Invalid amount',
      };
    }

    // Convert amount to integer base units
    const parsedInAmount = parseUnits(srcAmount, srcDecimals).toString();

    // Fallback recipient if wallet not yet connected (must be standard EOA, not contract)
    const fallbackAddr = userAddress && userAddress.startsWith('0x') && userAddress.length === 42
      ? userAddress
      : '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    const targetRecipient = recipientAddress && recipientAddress.startsWith('0x') && recipientAddress.length === 42
      ? recipientAddress
      : fallbackAddr;

    const query = new URLSearchParams({
      srcChainId: srcChainId.toString(),
      srcChainTokenIn: srcTokenAddress,
      srcChainTokenInAmount: parsedInAmount,
      dstChainId: dstChainId.toString(),
      dstChainTokenOut: dstTokenAddress,
      prependOperatingExpenses: 'true',
      enableAggregator: 'true',
    });

    query.set('dstChainTokenOutRecipient', targetRecipient);

    if (userAddress && userAddress.startsWith('0x')) {
      query.set('srcChainOrderAuthorityAddress', userAddress);
      query.set('dstChainOrderAuthorityAddress', userAddress);
    } else {
      query.set('srcChainOrderAuthorityAddress', targetRecipient);
    }

    if (slippagePercent > 0) {
      query.set('allowedSlippage', slippagePercent.toString());
    }

    // Explicit on-chain fee routing: automatically route PayFlux platform fee to the verified revenue wallet
    query.set('affiliateFeeRecipient', PAYFLUX_TREASURY_ADDRESS);
    query.set('affiliateFeePercent', '0.1');

    console.log('[PayFlux deBridge Provider] Outbound API Request:', {
      endpoint: DEBRIDGE_API_URL,
      requestFormat: 'GET URL query parameters',
      sourceChainId: srcChainId,
      destinationChainId: dstChainId,
      sourceTokenAddress: srcTokenAddress,
      destinationTokenAddress: dstTokenAddress,
      inputAmountSmallestUnits: parsedInAmount,
      connectedWalletAddress: userAddress,
      recipientAddress: userAddress || recipientAddress,
      slippagePercent,
      fullUrl: `${DEBRIDGE_API_URL}?${query.toString()}`,
    });

    const response = await fetch(`${DEBRIDGE_API_URL}?${query.toString()}`);
    const data = await response.json();

    if (!response.ok || data.errorMessage || data.errorCode) {
      const err = data.errorMessage || `deBridge error (${data.errorCode || response.status})`;
      return {
        success: false,
        estimatedAmountOut: '0',
        formattedAmountOut: '0.00',
        approximateUsdValue: 0,
        originApproximateUsdValue: 0,
        fixFee: '0',
        protocolFeeApproximateUsdValue: 0,
        estimatedOperatingExpenseUsd: 0,
        errorMessage: err,
      };
    }

    const dstOut = data.estimation?.dstChainTokenOut;
    const rawOutAmount = dstOut?.recommendedAmount || dstOut?.amount || '0';
    const formattedOut = formatUnits(BigInt(rawOutAmount), dstDecimals);

    return {
      success: true,
      orderId: data.orderId,
      estimatedAmountOut: rawOutAmount,
      formattedAmountOut: parseFloat(formattedOut).toLocaleString(undefined, {
        maximumFractionDigits: dstDecimals > 6 ? 6 : dstDecimals,
        minimumFractionDigits: 2,
      }),
      approximateUsdValue: parseFloat(String(dstOut?.approximateUsdValue || '0')) || 0,
      originApproximateUsdValue: parseFloat(String(data.estimation?.srcChainTokenIn?.approximateUsdValue || '0')) || 0,
      fixFee: String(data.fixFee || '0'),
      protocolFeeApproximateUsdValue: parseFloat(String(data.protocolFeeApproximateUsdValue || '0')) || 0,
      estimatedOperatingExpenseUsd: parseFloat(String(data.estimation?.srcChainTokenIn?.approximateOperatingExpense || '0')) || 0,
      tx: data.tx
        ? {
            to: data.tx.to as `0x${string}`,
            data: data.tx.data as `0x${string}`,
            value: data.tx.value || '0',
            allowanceTarget: (data.tx.allowanceTarget || data.tx.to) as `0x${string}`,
            allowanceValue: data.tx.allowanceValue,
          }
        : undefined,
      costsDetails: data.estimation?.costsDetails,
      recommendedSlippage: data.estimation?.recommendedSlippage !== undefined ? parseFloat(String(data.estimation.recommendedSlippage)) : undefined,
    };
  } catch (err: any) {
    console.error('fetchDeBridgeQuote exception:', err);
    return {
      success: false,
      estimatedAmountOut: '0',
      formattedAmountOut: '0.00',
      approximateUsdValue: 0,
      originApproximateUsdValue: 0,
      fixFee: '0',
      protocolFeeApproximateUsdValue: 0,
      estimatedOperatingExpenseUsd: 0,
      errorMessage: err.message || 'Failed to fetch quote from deBridge',
    };
  }
}

export async function checkDeBridgeOrderStatus(orderId: string): Promise<{
  state: 'Fulfilled' | 'Created' | 'ClaimedUnlock' | 'OrderCancelled' | 'Executed' | 'Unknown';
  percent?: number;
  txHash?: string;
}> {
  try {
    const res = await fetch(`https://stats-api.dln.trade/v1.0/dln/order/${orderId}/status`);
    if (!res.ok) return { state: 'Unknown' };
    const data = await res.json();
    return {
      state: data.state || 'Created',
      percent: data.percent,
      txHash: data.txHash,
    };
  } catch (e) {
    return { state: 'Unknown' };
  }
}
