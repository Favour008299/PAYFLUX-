import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  CheckCircle,
  ExternalLink,
  Share2,
  Copy,
  Check,
  Zap,
  ArrowRight,
  Globe,
  ShieldCheck
} from 'lucide-react';
import { TransactionRecord, UserSettings } from '../types';
import { shortenAddress, formatCurrency } from '../utils/crypto';

interface SwapSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  tx: TransactionRecord | null;
  onOpenExplorer: (tx: TransactionRecord) => void;
  onShareReceipt: (tx: TransactionRecord) => void;
  settings: UserSettings;
}

export const SwapSuccessModal: React.FC<SwapSuccessModalProps> = ({
  isOpen,
  onClose,
  tx,
  onOpenExplorer,
  onShareReceipt,
  settings,
}) => {
  const [copiedHash, setCopiedHash] = useState(false);

  useEffect(() => {
    if (isOpen) {
      try {
        confetti({
          particleCount: 90,
          spread: 75,
          origin: { y: 0.6 },
          colors: ['#00D4FF', '#A855F7', '#10B981', '#6366F1'],
        });
      } catch (err) {
        // Safe fallback
      }
    }
  }, [isOpen]);

  if (!isOpen || !tx) return null;

  const handleCopyHash = () => {
    navigator.clipboard.writeText(tx.hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="swap-success-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-slate-100 text-center animate-in zoom-in-95 duration-150"
      >
        {/* Success Check Badge */}
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center mb-4 shadow-lg shadow-emerald-950/50">
          <CheckCircle className="w-8 h-8" />
        </div>

        <h3 className="text-xl font-black text-white mb-1">Swap Confirmed On-Chain</h3>
        <p className="text-xs text-slate-400 mb-5">
          {tx.orderId
            ? 'Transaction executed via deBridge DLN cross-chain infrastructure.'
            : 'Your transaction has been broadcasted and confirmed on Polygon.'}
        </p>

        {/* Transaction Summary Card */}
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-left space-y-3 mb-5">
          {/* Swapped Pair Amounts */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Swapped
              </span>
              <div className="text-sm font-bold text-white font-mono">
                {tx.fromAmount} {tx.fromTokenSymbol}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-cyan-400" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
                Received
              </span>
              <div className="text-sm font-bold text-emerald-300 font-mono">
                +{tx.toAmount} {tx.toTokenSymbol}
              </div>
            </div>
          </div>

          {/* Transaction Hash */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Transaction ID</span>
            <div className="flex items-center gap-1.5 font-mono text-cyan-300">
              <span>{shortenAddress(tx.hash, 5)}</span>
              <button
                id="copy-tx-hash-btn"
                onClick={handleCopyHash}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Copy Hash"
              >
                {copiedHash ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* deBridge Order ID if available */}
          {tx.orderId && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1">
                <Globe className="w-3 h-3 text-purple-400" />
                <span>deBridge Order ID</span>
              </span>
              <span className="font-mono text-purple-300 text-[11px]">
                {shortenAddress(tx.orderId, 6)}
              </span>
            </div>
          )}

          {/* Timestamp */}
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="text-slate-400">Timestamp</span>
            <span className="font-mono text-slate-200">
              {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>

          {/* Network Fee */}
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="text-slate-400">Network / Protocol Fee</span>
            <span className="font-mono text-slate-200">
              {formatCurrency(tx.networkFeeUsd, settings.currency)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <a
            id="view-explorer-btn"
            href={tx.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
            <span>Polygonscan</span>
          </a>

          {tx.orderId ? (
            <a
              id="view-debridge-order-btn"
              href={`https://app.debridge.finance/order?orderId=${tx.orderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-purple-900/40 hover:bg-purple-900/60 border border-purple-700/50 text-xs font-bold text-purple-200 transition-colors"
            >
              <Globe className="w-3.5 h-3.5 text-purple-400" />
              <span>deBridge Order</span>
            </a>
          ) : (
            <button
              id="share-receipt-btn"
              onClick={() => onShareReceipt(tx)}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Share Receipt</span>
            </button>
          )}
        </div>

        {/* Done / Swap Again Primary CTA */}
        <button
          id="close-swap-success-btn"
          onClick={onClose}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-400 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-extrabold text-sm shadow-lg shadow-cyan-500/20 transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          Done
        </button>
      </div>
    </div>
  );
};
