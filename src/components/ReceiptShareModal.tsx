import React, { useState } from 'react';
import {
  X,
  Share2,
  Download,
  Copy,
  Check,
  Zap,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import { TransactionRecord, UserSettings } from '../types';
import { formatCurrency, shortenAddress } from '../utils/crypto';

interface ReceiptShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  tx: TransactionRecord | null;
  settings: UserSettings;
}

export const ReceiptShareModal: React.FC<ReceiptShareModalProps> = ({
  isOpen,
  onClose,
  tx,
  settings,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !tx) return null;

  const handleCopyReceiptText = () => {
    const text = `PayFlux Verified Receipt\nType: ${tx.type.toUpperCase()}\nSwapped: ${tx.fromAmount} ${tx.fromTokenSymbol} for ${tx.toAmount} ${tx.toTokenSymbol}\nTxHash: ${tx.hash}\nTimestamp: ${new Date(tx.timestamp).toLocaleString()}\nPlatform Fee: 0.1 POL (PayFlux Fixed Fee)\nExplorer: https://versescan.org/tx/${tx.hash}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="receipt-share-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <Share2 className="w-4 h-4 text-cyan-400" />
            </div>
            <h3 className="font-extrabold text-base text-white">Share Swap Receipt</h3>
          </div>
          <button
            id="close-receipt-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable / Visual Receipt Card */}
        <div
          id="visual-receipt-card"
          className="p-5 rounded-2xl bg-gradient-to-b from-slate-950 to-slate-900 border border-cyan-500/30 shadow-xl space-y-4 mb-4 relative overflow-hidden text-left"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center text-slate-950 font-black text-sm">
                V
              </div>
              <span className="font-extrabold text-sm text-white">PayFlux</span>
            </div>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
              Verified On-Chain
            </span>
          </div>

          <div className="text-center py-2">
            <div className="text-[11px] text-slate-400 uppercase font-semibold">
              Total Swap Output
            </div>
            <div className="text-2xl font-black text-cyan-300 font-mono">
              +{tx.toAmount} {tx.toTokenSymbol}
            </div>
            <div className="text-xs text-slate-400">
              From {tx.fromAmount} {tx.fromTokenSymbol}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1.5 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Date:</span>
              <span className="text-slate-200">{new Date(tx.timestamp).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Time:</span>
              <span className="text-slate-200">{new Date(tx.timestamp).toLocaleTimeString()}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Tx ID:</span>
              <span className="text-cyan-300">{shortenAddress(tx.hash, 5)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Platform Fee:</span>
              <span className="text-slate-200">0.1 POL (PayFlux Fixed Fee)</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleCopyReceiptText}
            className="py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied Details' : 'Copy Receipt'}</span>
          </button>
          <button
            onClick={onClose}
            className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
