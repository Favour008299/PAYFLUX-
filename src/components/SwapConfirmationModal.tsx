import React, { useState } from 'react';
import {
  ArrowDown,
  ShieldCheck,
  Fuel,
  Sliders,
  AlertTriangle,
  X,
  Zap,
  Lock,
  Sparkles
} from 'lucide-react';
import { SwapQuote, UserSettings } from '../types';
import { formatCurrency, formatTokenAmount } from '../utils/crypto';

interface SwapConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  quote: SwapQuote | null;
  onConfirm: () => void;
  settings: UserSettings;
}

export const SwapConfirmationModal: React.FC<SwapConfirmationModalProps> = ({
  isOpen,
  onClose,
  quote,
  onConfirm,
  settings,
}) => {
  const [agreedToRisk, setAgreedToRisk] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);

  // Reset confirming state when modal opens/closes
  React.useEffect(() => {
    if (!isOpen) {
      setIsConfirming(false);
    }
  }, [isOpen]);

  if (!isOpen || !quote) return null;

  const { fromToken, toToken, fromAmount, toAmount, exchangeRate, networkFeeUsd, slippageTolerance, minimumReceived, priceImpact } = quote;

  const handleConfirmClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isConfirming) return;
    setIsConfirming(true);
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="swap-confirmation-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">Confirm Swap</h3>
              <p className="text-[11px] text-slate-400">Review your transaction details</p>
            </div>
          </div>
          <button
            id="close-confirmation-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tokens Exchange Summary Card */}
        <div className="my-4 space-y-2">
          {/* You Pay Box */}
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                You Pay
              </span>
              <div className="text-xl font-black text-white font-mono">
                {fromAmount} {fromToken.symbol}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                ≈ {formatCurrency(parseFloat(fromAmount) * fromToken.priceUsd, settings.currency)}
              </div>
            </div>
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm shadow-md"
              style={{ backgroundColor: fromToken.iconBg, color: fromToken.iconColor }}
            >
              {fromToken.symbol.charAt(0)}
            </div>
          </div>

          {/* Arrow Divider */}
          <div className="flex justify-center -my-2 relative z-10">
            <div className="w-7 h-7 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center text-cyan-400">
              <ArrowDown className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* You Receive Box */}
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">
                You Receive (Estimated)
              </span>
              <div className="text-xl font-black text-cyan-300 font-mono">
                {toAmount} {toToken.symbol}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                ≈ {formatCurrency(parseFloat(toAmount) * toToken.priceUsd, settings.currency)}
              </div>
            </div>
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm shadow-md"
              style={{ backgroundColor: toToken.iconBg, color: toToken.iconColor }}
            >
              {toToken.symbol.charAt(0)}
            </div>
          </div>
        </div>

        {/* Detailed Breakdown */}
        <div className="p-3.5 rounded-2xl bg-slate-950/50 border border-slate-800/80 text-xs space-y-2 mb-4">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Exchange Rate</span>
            <span className="font-mono font-bold text-white">
              1 {fromToken.symbol} = {exchangeRate < 0.0001 ? exchangeRate.toExponential(4) : exchangeRate.toFixed(6)} {toToken.symbol}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400 flex items-center gap-1">
              <Fuel className="w-3.5 h-3.5 text-slate-400" />
              <span>Network Gas Fee</span>
            </span>
            <span className="font-mono font-medium text-slate-200">
              ~{formatCurrency(networkFeeUsd, settings.currency)}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>PayFlux Platform Fee</span>
            </span>
            <span className="font-mono font-bold text-purple-300">
              $0.10 USD
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Slippage Tolerance</span>
            <span className="font-mono font-medium text-slate-200">{slippageTolerance}%</span>
          </div>

          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Minimum Received</span>
            <span className="font-mono font-bold text-emerald-400">
              {minimumReceived} {toToken.symbol}
            </span>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[11px]">
            <span className="text-slate-400">Order Routing</span>
            <span className="text-purple-300 font-semibold flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-400" />
              {quote.route || 'deBridge DLN Cross-Chain Infrastructure'}
            </span>
          </div>
        </div>

        {/* Security / Verification badge */}
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[11px] text-slate-300 mb-5">
          <ShieldCheck className="w-4 h-4 text-purple-400 flex-shrink-0" />
          <span>Real on-chain settlement secured by deBridge and Polygon.</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            id="cancel-swap-btn"
            disabled={isConfirming}
            onClick={onClose}
            className="w-1/3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-bold text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            id="confirm-swap-action-btn"
            disabled={isConfirming}
            onClick={handleConfirmClick}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-75 disabled:cursor-not-allowed text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
          >
            {isConfirming ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span>Initiating Swap...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-current" />
                <span>Confirm Swap</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
