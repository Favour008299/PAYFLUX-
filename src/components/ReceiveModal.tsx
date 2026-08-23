import React, { useState } from 'react';
import {
  X,
  QrCode,
  Copy,
  Check,
  Share2,
  AlertCircle,
  ShieldCheck,
  ChevronDown
} from 'lucide-react';
import { Token, WalletAccount } from '../types';
import { shortenAddress } from '../utils/crypto';
import { TokenIcon } from './TokenIcon';
import { QRCodeDisplay } from './QRCodeDisplay';

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  wallet: WalletAccount;
  onShareReceipt?: () => void;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  isOpen,
  onClose,
  tokens,
  wallet,
}) => {
  const [selectedToken, setSelectedToken] = useState<Token>(tokens[0]);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPaymentLink = () => {
    const link = `https://verseswap.app/pay?token=${selectedToken.symbol}&to=${wallet.address}`;
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="receive-crypto-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 text-center animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <QrCode className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-left">
              <h3 className="font-extrabold text-base text-white">Receive Crypto</h3>
              <p className="text-[11px] text-slate-400">Scan or copy address to deposit funds</p>
            </div>
          </div>
          <button
            id="close-receive-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Token Selector Filter */}
        <div className="mb-4">
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {tokens.slice(0, 5).map((t) => {
              const tokenKey = t.id || `${t.symbol}-${t.network}`;
              const isSelected = selectedToken.id === t.id || (selectedToken.symbol === t.symbol && selectedToken.network === t.network);
              return (
                <button
                  key={tokenKey}
                  onClick={() => setSelectedToken(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                    isSelected
                      ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <TokenIcon token={t} size="xs" />
                  <span>{t.symbol}</span>
                  <span className="text-[9px] text-slate-500 capitalize">({t.network === 'polygon' ? 'POL' : 'ETH'})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* High-Contrast Crisp QR Code */}
        <div className="flex justify-center mb-4">
          <QRCodeDisplay
            value={`${selectedToken.network === 'polygon' ? 'polygon' : 'ethereum'}:${wallet.address}`}
            size={180}
            showDownloadButton={true}
            altText={`Receive ${selectedToken.symbol} QR Code`}
          />
        </div>

        {/* Address Card with Copy */}
        <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 mb-4 flex items-center justify-between gap-2">
          <div className="text-left overflow-hidden">
            <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
              {selectedToken.name} Deposit Address ({selectedToken.networkName})
            </div>
            <div className="text-xs font-mono font-bold text-cyan-300 truncate">
              {wallet.address}
            </div>
          </div>
          <button
            id="receive-copy-address-btn"
            onClick={handleCopy}
            className="p-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all shadow-md flex-shrink-0"
            title="Copy Address"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        {/* Actions row */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            id="copy-address-text-btn"
            onClick={handleCopy}
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors flex items-center justify-center gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{copied ? 'Copied!' : 'Copy Address'}</span>
          </button>
          <button
            id="copy-payment-link-btn"
            onClick={handleCopyPaymentLink}
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors flex items-center justify-center gap-1.5"
          >
            {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{linkCopied ? 'Link Copied!' : 'Share Pay Link'}</span>
          </button>
        </div>

        {/* Network Safeguard Warning */}
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-left text-xs text-amber-300">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <span className="text-[11px] leading-tight">
            Send only <strong className="text-amber-200">{selectedToken.name}</strong> ({selectedToken.networkName}) to this address. Sending other unsupported assets will result in permanent loss.
          </span>
        </div>
      </div>
    </div>
  );
};
