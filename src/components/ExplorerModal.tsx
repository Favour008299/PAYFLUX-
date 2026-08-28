import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  CheckCircle2,
  Copy,
  Check,
  Zap,
  Box,
  Fuel,
  Clock,
  Layers,
  ArrowRight
} from 'lucide-react';
import { TransactionRecord, UserSettings } from '../types';
import { shortenAddress, formatCurrency } from '../utils/crypto';

interface ExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  tx: TransactionRecord | null;
  settings: UserSettings;
}

export const ExplorerModal: React.FC<ExplorerModalProps> = ({
  isOpen,
  onClose,
  tx,
  settings,
}) => {
  const [copiedHash, setCopiedHash] = useState(false);

  if (!isOpen || !tx) return null;

  const handleCopyHash = () => {
    navigator.clipboard.writeText(tx.hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="explorer-modal"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base text-white">VerseScan Explorer</h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  Confirmed
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Multi-Chain On-Chain Ledger</p>
            </div>
          </div>
          <button
            id="close-explorer-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Transaction Overview Card */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 mb-4 text-xs font-mono">
          {/* Hash */}
          <div>
            <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Transaction Hash</div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-900 border border-slate-800 text-cyan-300 break-all text-[11px]">
              <span>{tx.hash}</span>
              <button
                onClick={handleCopyHash}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 ml-2 flex-shrink-0"
              >
                {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Status & Block */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-[10px] text-slate-500 uppercase block">Status</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Success (12 Confirmations)</span>
              </span>
            </div>

            <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-[10px] text-slate-500 uppercase block">Block Number</span>
              <span className="text-white font-bold flex items-center gap-1 mt-0.5">
                <Box className="w-3.5 h-3.5 text-cyan-400" />
                <span>#{tx.blockNumber}</span>
              </span>
            </div>
          </div>

          {/* Action details */}
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1.5">
            <div className="flex justify-between text-slate-400">
              <span>Transaction Type:</span>
              <span className="text-white uppercase font-bold">{tx.type}</span>
            </div>

            {tx.type === 'swap' ? (
              <div className="flex justify-between text-slate-400">
                <span>Swap Path:</span>
                <span className="text-cyan-300 font-bold">
                  {tx.fromAmount} {tx.fromTokenSymbol} → {tx.toAmount} {tx.toTokenSymbol}
                </span>
              </div>
            ) : (
              <div className="flex justify-between text-slate-400">
                <span>Transfer Amount:</span>
                <span className="text-cyan-300 font-bold">
                  {tx.amount} {tx.tokenSymbol}
                </span>
              </div>
            )}

            <div className="flex justify-between text-slate-400">
              <span>Timestamp:</span>
              <span className="text-slate-200">{new Date(tx.timestamp).toLocaleString()}</span>
            </div>

            <div className="flex justify-between text-slate-400">
              <span>Gas Fee:</span>
              <span className="text-slate-200">{formatCurrency(tx.networkFeeUsd, settings.currency)}</span>
            </div>

            <div className="flex justify-between text-slate-400">
              <span>Settlement Protocol:</span>
              <span className="text-purple-400 font-semibold font-mono text-[11px]">
                {tx.orderId ? 'deBridge DLN Protocol' : 'PayFlux Smart Router'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors"
        >
          Close Explorer View
        </button>
      </div>
    </div>
  );
};
