import React, { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  X,
  Copy,
  Check,
  Store,
  ArrowDownLeft,
  ShieldCheck,
  Printer,
  Receipt,
  Layers
} from 'lucide-react';
import { MerchantReceipt } from '../types';
import { shortenAddress } from '../utils/crypto';
import { getExplorerTxUrl } from '../services/contractConfig';

interface MerchantReceiptModalProps {
  receipt: MerchantReceipt | null;
  isOpen: boolean;
  onClose: () => void;
}

export const MerchantReceiptModal: React.FC<MerchantReceiptModalProps> = ({
  receipt,
  isOpen,
  onClose,
}) => {
  const [copiedHash, setCopiedHash] = useState(false);

  if (!isOpen || !receipt) return null;

  const handleCopyHash = () => {
    if (receipt.txHash) {
      navigator.clipboard.writeText(receipt.txHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const explorerUrl =
    receipt.explorerUrl ||
    getExplorerTxUrl(receipt.network === 'Polygon' ? 'polygon' : 'ethereum', receipt.txHash);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-6 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Subtle Top Gradient Accent */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-400 via-cyan-500 to-blue-500" />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-white">Merchant Receipt</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Confirmed On-Chain</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Official PayFlux Proof of Merchant Settlement
              </p>
            </div>
          </div>

          <button
            id="close-merchant-receipt-modal-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settlement Banner */}
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-center sm:text-left">
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Payment Received
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono mt-0.5">
              +{receipt.amount} {receipt.merchantReceivingAsset}
            </div>
            {receipt.fiatAmount > 0 && (
              <div className="text-xs text-slate-400 font-medium">
                ≈ {receipt.fiatAmount.toLocaleString()} {receipt.fiatCurrency}
              </div>
            )}
          </div>

          <div className="flex flex-col items-center sm:items-end justify-center">
            <span className="px-3 py-1 rounded-xl text-xs font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>{receipt.network} Network</span>
            </span>
            <span className="text-[10px] text-slate-500 mt-1">Direct Non-Custodial</span>
          </div>
        </div>

        {/* Receipt Spec Details List */}
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
            <span className="text-slate-400 font-semibold">Payment Received</span>
            <span className="font-mono font-bold text-emerald-400">
              {receipt.amount} {receipt.merchantReceivingAsset}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
            <span className="text-slate-400 font-semibold">Product / Service</span>
            <span className="font-bold text-white text-right max-w-[220px] truncate">
              {receipt.productName}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
            <span className="text-slate-400 font-semibold">Amount</span>
            <span className="font-mono font-bold text-white">
              {receipt.amount}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
            <span className="text-slate-400 font-semibold">Customer Payment Asset</span>
            <span className="font-mono font-bold text-cyan-300">
              {receipt.customerPaymentAsset}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
            <span className="text-slate-400 font-semibold">Merchant Receiving Asset</span>
            <span className="font-mono font-bold text-purple-300">
              {receipt.merchantReceivingAsset}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
            <span className="text-slate-400 font-semibold">Network</span>
            <span className="font-bold text-white">
              {receipt.network}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
            <span className="text-slate-400 font-semibold">Date / Time</span>
            <span className="font-mono text-slate-300 text-right">
              {new Date(receipt.timestamp).toLocaleDateString()} {new Date(receipt.timestamp).toLocaleTimeString()}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
            <span className="text-slate-400 font-semibold">Confirmed Status</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              {receipt.status} on-chain
            </span>
          </div>

          {receipt.payerAddress && (
            <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
              <span className="text-slate-400 font-semibold">Payer Address</span>
              <span className="font-mono text-cyan-300 font-bold">
                {shortenAddress(receipt.payerAddress, 5)}
              </span>
            </div>
          )}

          {receipt.merchantAddress && (
            <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
              <span className="text-slate-400 font-semibold">Merchant Receiving Wallet</span>
              <span className="font-mono text-slate-300">
                {shortenAddress(receipt.merchantAddress, 5)}
              </span>
            </div>
          )}

          {/* Real On-Chain Transaction Hash */}
          <div className="pt-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-bold">Real Transaction Hash</span>
              <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Verified Blockchain Transaction</span>
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-cyan-300 truncate">
                {receipt.txHash}
              </span>
              <button
                id="copy-merchant-receipt-tx-btn"
                onClick={handleCopyHash}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                title="Copy Transaction Hash"
              >
                {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <a
            id="view-on-explorer-merchant-receipt-link"
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2"
          >
            <ExternalLink className="w-4 h-4 text-cyan-400" />
            <span>Verify on Block Explorer</span>
          </a>

          <button
            id="print-merchant-receipt-btn"
            onClick={handlePrint}
            className="py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-black text-xs transition-colors flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Save Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
