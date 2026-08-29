import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  Info,
  Sparkles,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  Zap,
  Fuel,
  Sliders,
  Wallet,
  Globe,
  CheckCircle2,
  Layers
} from 'lucide-react';
import { Token, SwapQuote, WalletAccount, UserSettings } from '../types';
import { formatCurrency, formatTokenAmount } from '../utils/crypto';
import { TokenIcon } from './TokenIcon';
import { getRealSwapQuote, SwapRouteQuote } from '../services/realSwapRouter';
import { PAYFLUX_PLATFORM_FEE_USD } from '../config/platform';

interface SwapCardProps {
  tokens: Token[];
  wallet: WalletAccount | null;
  settings: UserSettings;
  onInitiateSwap: (quote: SwapQuote) => void;
  onOpenConnectModal: () => void;
  onOpenTokenSelector: (target: 'from' | 'to') => void;
  fromToken: Token;
  toToken: Token;
  onSwapPair: () => void;
  onOpenChart: () => void;
}

export const SwapCard: React.FC<SwapCardProps> = ({
  tokens,
  wallet,
  settings,
  onInitiateSwap,
  onOpenConnectModal,
  onOpenTokenSelector,
  fromToken,
  toToken,
  onSwapPair,
  onOpenChart,
}) => {
  const [fromAmount, setFromAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<number>(settings.slippageTolerance || 0.5);
  const [customSlippage, setCustomSlippage] = useState<string>('');
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  const [gasSpeed, setGasSpeed] = useState<'eco' | 'standard' | 'fast'>(settings.gasSpeed || 'standard');
  const [quoteCountdown, setQuoteCountdown] = useState<number>(12);
  const [isRotating, setIsRotating] = useState(false);

  // Real Quote State
  const [isLoadingQuote, setIsLoadingQuote] = useState<boolean>(false);
  const [swapRouteQuote, setSwapRouteQuote] = useState<SwapRouteQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const isCrossChain = fromToken.network !== toToken.network;

  // Derived effective exchange rate and output amount
  const parsedFromAmount = parseFloat(fromAmount) || 0;
  const swapValueUsd = parsedFromAmount * (fromToken?.priceUsd || 0);

  // Network fee in USD
  const networkFeeUsd = useMemo(() => {
    if (swapRouteQuote?.estimatedGasUsd !== undefined && swapRouteQuote?.estimatedGasUsd !== null) {
      const gasNum = typeof swapRouteQuote.estimatedGasUsd === 'number'
        ? swapRouteQuote.estimatedGasUsd
        : parseFloat(String(swapRouteQuote.estimatedGasUsd));
      if (!isNaN(gasNum) && gasNum > 0) {
        return parseFloat(gasNum.toFixed(2));
      }
    }
    const baseFee = fromToken.network === 'ethereum' ? 2.85 : 0.05;
    const speedMult = gasSpeed === 'eco' ? 0.75 : gasSpeed === 'fast' ? 1.4 : 1.0;
    return parseFloat((baseFee * speedMult).toFixed(2));
  }, [fromToken.network, gasSpeed, swapRouteQuote]);

  // Minimum required value to cover platform fee ($0.10) plus network costs
  const totalMinCostUsd = PAYFLUX_PLATFORM_FEE_USD + networkFeeUsd;
  const isAmountTooSmall = parsedFromAmount > 0 && (
    swapValueUsd <= totalMinCostUsd ||
    swapValueUsd <= PAYFLUX_PLATFORM_FEE_USD ||
    swapValueUsd < 0.15
  );

  // Auto-refresh countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteCountdown((prev) => (prev <= 1 ? 12 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch real on-chain quote whenever amount, pair, or slippage changes
  useEffect(() => {
    let isMounted = true;
    const numIn = parseFloat(fromAmount);

    if (!fromAmount || isNaN(numIn) || numIn <= 0) {
      setSwapRouteQuote(null);
      setQuoteError(null);
      setIsLoadingQuote(false);
      return;
    }

    const valueUsd = numIn * (fromToken?.priceUsd || 0);
    const minRequired = PAYFLUX_PLATFORM_FEE_USD + networkFeeUsd;
    if (valueUsd > 0 && (valueUsd <= minRequired || valueUsd <= PAYFLUX_PLATFORM_FEE_USD || valueUsd < 0.15)) {
      setSwapRouteQuote(null);
      setQuoteError('Swap amount too small — increase the amount.');
      setIsLoadingQuote(false);
      return;
    }

    async function loadQuote() {
      setIsLoadingQuote(true);
      setQuoteError(null);

      // Determine chain IDs and token addresses
      const srcChainId = fromToken.network === 'ethereum' ? 1 : 137;
      const dstChainId = toToken.network === 'ethereum' ? 1 : 137;

      const srcTokenAddr = fromToken.contractAddress || '0x0000000000000000000000000000000000000000';
      const dstTokenAddr = toToken.contractAddress || '0x0000000000000000000000000000000000000000';

      const result = await getRealSwapQuote({
        srcChainId,
        srcTokenAddress: srcTokenAddr,
        srcDecimals: fromToken.decimals,
        srcSymbol: fromToken.symbol,
        srcAmount: fromAmount,
        dstChainId,
        dstTokenAddress: dstTokenAddr,
        dstDecimals: toToken.decimals,
        dstSymbol: toToken.symbol,
        userAddress: wallet?.address,
        slippagePercent: slippage,
      });

      if (!isMounted) return;
      setIsLoadingQuote(false);

      if (result.success) {
        setSwapRouteQuote(result);
        setQuoteError(null);
      } else {
        setSwapRouteQuote(null);
        setQuoteError(result.errorMessage || 'Swap unavailable — no route found for this token pair or amount.');
      }
    }

    const debounceTimer = setTimeout(loadQuote, 350);
    return () => {
      isMounted = false;
      clearTimeout(debounceTimer);
    };
  }, [fromAmount, fromToken, toToken, slippage, wallet?.address, networkFeeUsd]);

  // Compute fallback / standard exchange rate
  const standardExchangeRate = useMemo(() => {
    if (!toToken.priceUsd || toToken.priceUsd === 0) return 0;
    return fromToken.priceUsd / toToken.priceUsd;
  }, [fromToken.priceUsd, toToken.priceUsd]);

  const { toAmount, exchangeRate, inverseRate } = useMemo(() => {
    if (parsedFromAmount <= 0 || isAmountTooSmall) {
      return { toAmount: '', exchangeRate: standardExchangeRate, inverseRate: standardExchangeRate > 0 ? 1 / standardExchangeRate : 0 };
    }

    if (swapRouteQuote && swapRouteQuote.success && swapRouteQuote.formattedAmountOut) {
      const numOut = parseFloat(swapRouteQuote.formattedAmountOut.replace(/,/g, '')) || 0;
      const rate = parsedFromAmount > 0 ? numOut / parsedFromAmount : 0;
      return {
        toAmount: swapRouteQuote.formattedAmountOut,
        exchangeRate: rate,
        inverseRate: rate > 0 ? 1 / rate : 0,
      };
    }

    if (quoteError) {
      return {
        toAmount: '',
        exchangeRate: 0,
        inverseRate: 0,
      };
    }

    return {
      toAmount: '',
      exchangeRate: standardExchangeRate,
      inverseRate: standardExchangeRate > 0 ? 1 / standardExchangeRate : 0,
    };
  }, [parsedFromAmount, isAmountTooSmall, swapRouteQuote, standardExchangeRate, quoteError]);

  // Price impact calculation
  const priceImpact = useMemo(() => {
    if (parsedFromAmount <= 0) return 0;
    if (swapRouteQuote?.priceImpact !== undefined && swapRouteQuote?.priceImpact !== null) {
      const rawImpact = typeof swapRouteQuote.priceImpact === 'number'
        ? swapRouteQuote.priceImpact
        : parseFloat(String(swapRouteQuote.priceImpact));
      if (!isNaN(rawImpact)) return rawImpact;
    }
    const tradeVolumeUsd = parsedFromAmount * fromToken.priceUsd;
    const impact = (tradeVolumeUsd / 500_000) * 100;
    return Math.min(Math.max(impact, 0.05), 12.0);
  }, [parsedFromAmount, fromToken.priceUsd, swapRouteQuote]);

  // Minimum received after slippage
  const minimumReceived = useMemo(() => {
    const numTo = parseFloat(toAmount.replace(/,/g, '')) || 0;
    if (numTo <= 0) return '0.00';
    const min = numTo * (1 - (slippage || 0.5) / 100);
    if (min >= 1000) return min.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    if (min >= 1) return min.toFixed(4);
    if (min >= 0.0001) return min.toFixed(6);
    return min.toExponential(4);
  }, [toAmount, slippage]);

  // Check user balance
  const userBalance = fromToken.balance;
  const hasInsufficientBalance = wallet !== null && parsedFromAmount > userBalance;

  // Quick preset percentages
  const handleSetPercentage = (percentage: number) => {
    if (!wallet) return;
    const amt = (userBalance * percentage).toFixed(fromToken.decimals > 8 ? 6 : fromToken.decimals);
    setFromAmount(parseFloat(amt) > 0 ? amt : '0');
  };

  const handleSwapClick = () => {
    if (!wallet) {
      onOpenConnectModal();
      return;
    }
    if (parsedFromAmount <= 0 || hasInsufficientBalance) return;
    if (isAmountTooSmall) return;
    if (quoteError) return;

    const quote: SwapQuote = {
      fromToken,
      toToken,
      fromAmount,
      toAmount,
      exchangeRate,
      inverseRate,
      priceImpact: parseFloat(priceImpact.toFixed(2)),
      networkFeeUsd,
      networkFeeToken: fromToken.network === 'ethereum' ? 'ETH' : 'POL',
      slippageTolerance: slippage,
      minimumReceived,
      route: swapRouteQuote?.routingProtocol === 'deBridge DLN'
        ? 'deBridge DLN Cross-Chain Infrastructure'
        : `${fromToken.networkName} On-Chain DEX Router`,
      estimatedTimeSeconds: isCrossChain ? 45 : 4,
      gasSpeed,
      orderId: swapRouteQuote?.rawResponse?.orderId,
      isDeBridge: isCrossChain,
      routingProtocol: swapRouteQuote?.routingProtocol,
      swapTx: swapRouteQuote?.transactionData
        ? {
            to: swapRouteQuote.transactionTo as `0x${string}`,
            data: swapRouteQuote.transactionData as `0x${string}`,
            value: swapRouteQuote.transactionValue || '0',
            allowanceTarget: swapRouteQuote.allowanceTarget as `0x${string}`,
          }
        : undefined,
      deBridgeTx: swapRouteQuote?.rawResponse?.tx,
      costsDetails: swapRouteQuote?.rawResponse?.costsDetails,
      fixFee: swapRouteQuote?.rawResponse?.fixFee,
    };

    onInitiateSwap(quote);
  };

  const handleFlip = () => {
    setIsRotating(true);
    onSwapPair();
    setTimeout(() => setIsRotating(false), 300);
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Outer Card Container */}
      <div
        id="swap-card-container"
        className="relative bg-slate-900/90 backdrop-blur-2xl border border-slate-800/90 rounded-3xl p-4 sm:p-5 shadow-2xl shadow-cyan-950/20 text-slate-100"
      >
        {/* Card Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
              <span>Swap</span>
              {isCrossChain ? (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                  <Globe className="w-2.5 h-2.5" />
                  <span>deBridge DLN</span>
                </span>
              ) : (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {fromToken.networkName} DEX
                </span>
              )}
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {/* View Price Chart Button */}
            <button
              id="open-chart-btn"
              onClick={onOpenChart}
              className="p-2 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-cyan-300 transition-colors"
              title="View Pair Chart"
            >
              <TrendingUp className="w-4 h-4" />
            </button>

            {/* Refresh countdown */}
            <button
              id="refresh-quote-btn"
              onClick={() => setQuoteCountdown(12)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] font-mono text-slate-400 hover:text-white transition-colors"
              title="Live Quote Status"
            >
              <RefreshCw
                className={`w-3 h-3 text-cyan-400 ${isLoadingQuote ? 'animate-spin' : ''}`}
              />
              <span>{isLoadingQuote ? 'Quoting' : `${quoteCountdown}s`}</span>
            </button>

            {/* Slippage & Gas Settings Toggle */}
            <button
              id="swap-settings-toggle-btn"
              onClick={() => setShowSettingsPopover(!showSettingsPopover)}
              className={`p-2 rounded-xl border transition-colors ${
                showSettingsPopover
                  ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                  : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:text-white'
              }`}
              title="Slippage & Gas Settings"
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Settings Popover */}
        {showSettingsPopover && (
          <div
            id="swap-settings-popover"
            className="mb-4 p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-3 animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Slippage section */}
            <div>
              <div className="flex items-center justify-between text-slate-400 mb-1.5">
                <span className="font-semibold text-slate-300">Slippage Tolerance</span>
                <span className="text-[11px] font-mono text-cyan-400 font-bold">{slippage}%</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[0.1, 0.5, 1.0].map((val) => (
                  <button
                    key={val}
                    id={`slippage-opt-${val}`}
                    onClick={() => {
                      setSlippage(val);
                      setCustomSlippage('');
                    }}
                    className={`py-1.5 rounded-lg font-bold text-xs transition-all ${
                      slippage === val && !customSlippage
                        ? 'bg-cyan-500 text-slate-950 shadow-sm'
                        : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
                <div className="relative">
                  <input
                    type="number"
                    placeholder="Custom"
                    value={customSlippage}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setCustomSlippage(e.target.value);
                      if (!isNaN(v) && v > 0 && v <= 50) setSlippage(v);
                    }}
                    className="w-full h-full text-center px-1 py-1 rounded-lg bg-slate-900 border border-slate-800 focus:border-cyan-500 text-xs font-bold text-white focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Gas Speed */}
            <div>
              <div className="flex items-center justify-between text-slate-400 mb-1.5">
                <span className="font-semibold text-slate-300">Network Speed</span>
                <span className="text-[11px] text-slate-400 capitalize font-medium">{gasSpeed} (~${networkFeeUsd})</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['eco', 'standard', 'fast'] as const).map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setGasSpeed(spd)}
                    className={`py-1.5 rounded-lg font-bold capitalize text-xs transition-all ${
                      gasSpeed === spd
                        ? 'bg-cyan-500 text-slate-950 shadow-sm'
                        : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {spd === 'eco' ? 'Eco' : spd === 'standard' ? 'Standard' : 'Fast ⚡'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= YOU PAY SECTION ================= */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-3.5 sm:p-4 mb-1.5 focus-within:border-cyan-500/60 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              You Pay
            </span>
            {wallet && (
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <span className="text-[11px]">
                  Bal: {formatTokenAmount(userBalance)} {fromToken.symbol}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    id="pay-half-btn"
                    onClick={() => handleSetPercentage(0.5)}
                    className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] font-bold text-cyan-400 border border-slate-800"
                  >
                    50%
                  </button>
                  <button
                    id="pay-max-btn"
                    onClick={() => handleSetPercentage(1.0)}
                    className="px-1.5 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] font-bold text-cyan-300 border border-cyan-500/30"
                  >
                    MAX
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            {/* Amount input */}
            <input
              id="swap-pay-amount-input"
              type="number"
              inputMode="decimal"
              placeholder="0.0"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              className="w-full bg-transparent text-2xl sm:text-3xl font-extrabold text-white focus:outline-none placeholder-slate-600 font-mono"
            />

            {/* Token Selector Trigger */}
            <button
              id="select-from-token-btn"
              onClick={() => onOpenTokenSelector('from')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex-shrink-0"
            >
              <TokenIcon token={fromToken} size="sm" />
              <div className="text-left">
                <span className="font-extrabold text-sm text-white block leading-tight">{fromToken.symbol}</span>
                <span className="text-[9px] text-purple-300 font-semibold uppercase">{fromToken.networkName || fromToken.network}</span>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {/* USD Calculation */}
          <div className="mt-2 text-xs font-mono text-slate-400">
            {parsedFromAmount > 0
              ? formatCurrency(parsedFromAmount * fromToken.priceUsd, settings.currency)
              : formatCurrency(0, settings.currency)}
          </div>
        </div>

        {/* ================= FLIP BUTTON ================= */}
        <div className="relative flex items-center justify-center -my-2.5 z-10">
          <button
            id="flip-swap-pair-btn"
            onClick={handleFlip}
            className={`p-2.5 rounded-2xl bg-slate-900 border-2 border-slate-800 hover:border-cyan-500 text-cyan-400 hover:text-white shadow-xl transition-all ${
              isRotating ? 'rotate-180 duration-300' : ''
            }`}
            title="Swap tokens"
          >
            <ArrowDownUp className="w-4 h-4" />
          </button>
        </div>

        {/* ================= YOU RECEIVE SECTION ================= */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-3.5 sm:p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              You Receive
            </span>
            {wallet && (
              <span className="text-[11px] text-slate-400">
                Bal: {formatTokenAmount(toToken.balance)} {toToken.symbol}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            {/* Output Amount */}
            <div
              id="swap-receive-amount-display"
              className="text-2xl sm:text-3xl font-extrabold text-white font-mono truncate"
            >
              {isLoadingQuote ? (
                <span className="text-slate-500 animate-pulse text-xl sm:text-2xl">Fetching quote...</span>
              ) : toAmount ? (
                toAmount
              ) : (
                <span className="text-slate-600">0.0</span>
              )}
            </div>

            {/* Token Selector Trigger */}
            <button
              id="select-to-token-btn"
              onClick={() => onOpenTokenSelector('to')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex-shrink-0"
            >
              <TokenIcon token={toToken} size="sm" />
              <div className="text-left">
                <span className="font-extrabold text-sm text-white block leading-tight">{toToken.symbol}</span>
                <span className="text-[9px] text-purple-300 font-semibold uppercase">{toToken.networkName || toToken.network}</span>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {/* USD Calculation */}
          <div className="mt-2 text-xs font-mono text-slate-400 flex items-center justify-between">
            <span>
              {parseFloat(toAmount.replace(/,/g, '')) > 0
                ? formatCurrency(
                    parseFloat(toAmount.replace(/,/g, '')) * toToken.priceUsd,
                    settings.currency
                  )
                : formatCurrency(0, settings.currency)}
            </span>
            {exchangeRate > 0 && (
              <span className="text-[11px] text-slate-400">
                1 {fromToken.symbol} ≈ {exchangeRate > 1000 ? exchangeRate.toFixed(2) : exchangeRate.toFixed(6)} {toToken.symbol}
              </span>
            )}
          </div>
        </div>

        {/* ================= SWAP DETAILS ACCORDION ================= */}
        <div className="bg-slate-950/40 rounded-2xl border border-slate-800/60 p-3.5 space-y-2 text-xs mb-4">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1">
              <span>Expected Rate</span>
            </span>
            <span className="font-mono text-slate-200">
              1 {fromToken.symbol} = {exchangeRate > 1000 ? exchangeRate.toFixed(2) : exchangeRate.toFixed(6)} {toToken.symbol}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1">
              <span>Minimum Received</span>
            </span>
            <span className="font-mono text-slate-200 font-medium">
              {minimumReceived} {toToken.symbol}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Platform Fee</span>
            </span>
            <span className="font-mono text-purple-300 font-bold">
              ${PAYFLUX_PLATFORM_FEE_USD.toFixed(2)} USD
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1">
              <Fuel className="w-3.5 h-3.5 text-slate-400" />
              <span>Est. Network Fee</span>
            </span>
            <span className="font-mono text-slate-200">
              ~${networkFeeUsd} ({fromToken.network === 'ethereum' ? 'ETH' : 'POL'})
            </span>
          </div>

          {priceImpact > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
              <span className="text-slate-400">Price Impact</span>
              <span
                className={`font-mono font-bold ${
                  priceImpact > 3
                    ? 'text-rose-400'
                    : priceImpact > 1
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {priceImpact.toFixed(2)}%
              </span>
            </div>
          )}

          {/* Routing route badge */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[11px]">
            <span className="text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span>Routing Protocol</span>
            </span>
            {isCrossChain ? (
              <span className="text-purple-300 font-semibold flex items-center gap-1">
                <span>deBridge DLN Cross-Chain</span>
              </span>
            ) : (
              <span className="text-cyan-300 font-semibold">
                {fromToken.networkName} On-Chain DEX Router
              </span>
            )}
          </div>
        </div>

        {/* Error notice if quote failed */}
        {quoteError && parsedFromAmount > 0 && (
          <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Swap Notice</p>
              <p className="text-[11px] text-amber-300/90">{quoteError}</p>
            </div>
          </div>
        )}

        {/* Main Action Button */}
        {!wallet ? (
          <button
            id="swap-connect-wallet-cta"
            onClick={onOpenConnectModal}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
          >
            <Wallet className="w-4 h-4" />
            <span>Connect Wallet to Swap</span>
          </button>
        ) : hasInsufficientBalance ? (
          <button
            id="swap-insufficient-btn"
            disabled
            className="w-full py-4 rounded-2xl bg-slate-800 border border-slate-700 text-slate-400 font-extrabold text-sm cursor-not-allowed opacity-80"
          >
            Insufficient {fromToken.symbol} Balance ({fromToken.networkName})
          </button>
        ) : parsedFromAmount <= 0 ? (
          <button
            id="swap-enter-amount-btn"
            disabled
            className="w-full py-4 rounded-2xl bg-slate-800/80 border border-slate-800 text-slate-500 font-extrabold text-sm cursor-not-allowed"
          >
            Enter an Amount
          </button>
        ) : isAmountTooSmall ? (
          <button
            id="swap-too-small-btn"
            disabled
            className="w-full py-4 rounded-2xl bg-amber-950/40 border border-amber-800/50 text-amber-300 font-extrabold text-sm cursor-not-allowed opacity-90"
          >
            Swap amount too small — increase the amount.
          </button>
        ) : isLoadingQuote ? (
          <button
            id="swap-loading-quote-btn"
            disabled
            className="w-full py-4 rounded-2xl bg-purple-900/40 border border-purple-700/50 text-purple-200 font-extrabold text-sm flex items-center justify-center gap-2 cursor-wait"
          >
            <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
            <span>Finding Best On-Chain Route...</span>
          </button>
        ) : quoteError ? (
          <button
            id="swap-unavailable-btn"
            disabled
            className="w-full py-4 rounded-2xl bg-rose-950/40 border border-rose-800/50 text-rose-300 font-extrabold text-sm cursor-not-allowed opacity-90"
          >
            {quoteError}
          </button>
        ) : (
          <button
            id="swap-now-btn"
            onClick={handleSwapClick}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-400 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-black text-base shadow-xl shadow-cyan-500/30 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
          >
            <Zap className="w-5 h-5 fill-current" />
            <span>Swap {fromToken.symbol} → {toToken.symbol}</span>
          </button>
        )}

        {/* Favorite Pair Quick Links */}
        <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
          <span>Popular Pairs:</span>
          <div className="flex items-center gap-2 font-semibold">
            <span className="text-cyan-400">VERSE (Polygon) ↔ POL</span>
            <span>•</span>
            <span className="text-purple-400">USDT ↔ VERSE</span>
            <span>•</span>
            <span className="text-emerald-400">USDC ↔ VERSE</span>
          </div>
        </div>
      </div>
    </div>
  );
};
