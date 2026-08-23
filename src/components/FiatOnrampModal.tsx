import React, { useState } from 'react';
import {
  X,
  CreditCard,
  CheckCircle2,
  Lock,
  ArrowRight,
  ShieldCheck,
  Zap,
  Globe
} from 'lucide-react';
import { Token, WalletAccount, UserSettings } from '../types';
import { formatCurrency } from '../utils/crypto';

interface FiatOnrampModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  wallet: WalletAccount | null;
  settings: UserSettings;
  onOpenConnectModal: () => void;
}

export const FiatOnrampModal: React.FC<FiatOnrampModalProps> = ({
  isOpen,
  onClose,
  tokens,
  wallet,
  settings,
  onOpenConnectModal,
}) => {
  const [fiatAmount, setFiatAmount] = useState('100');
  const [selectedToken, setSelectedToken] = useState<Token>(tokens[0]); // VERSE
  const [paymentProvider, setPaymentProvider] = useState<'moonpay' | 'banxa' | 'transak'>('moonpay');
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const numFiat = parseFloat(fiatAmount) || 0;
  const estimatedTokens = selectedToken.priceUsd > 0 ? (numFiat / selectedToken.priceUsd).toFixed(2) : '0';

  const handleBuy = () => {
    if (!wallet) {
      onOpenConnectModal();
      return;
    }
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 2500);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="fiat-onramp-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">Buy Crypto</h3>
              <p className="text-[11px] text-slate-400">Card, Apple Pay, Google Pay</p>
            </div>
          </div>
          <button
            id="close-fiat-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {success ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="font-black text-lg text-white">Purchase Initiated!</h4>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Your order of {fiatAmount} USD worth of {selectedToken.symbol} has been routed to your non-custodial wallet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Pay Amount (USD) */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                You Spend ({settings.currency})
              </label>
              <div className="flex items-center justify-between">
                <input
                  type="number"
                  value={fiatAmount}
                  onChange={(e) => setFiatAmount(e.target.value)}
                  className="w-full bg-transparent text-2xl font-black text-white font-mono focus:outline-none"
                />
                <span className="font-bold text-xs text-slate-400 uppercase bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                  {settings.currency}
                </span>
              </div>
            </div>

            {/* Receive Crypto Asset */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                You Get (~Estimated)
              </label>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-black text-cyan-300 font-mono">
                  {estimatedTokens}
                </div>
                <select
                  value={selectedToken.id || `${selectedToken.symbol}-${selectedToken.network}`}
                  onChange={(e) => {
                    const found = tokens.find((t) => (t.id || `${t.symbol}-${t.network}`) === e.target.value) || tokens.find((t) => t.symbol === e.target.value);
                    if (found) setSelectedToken(found);
                  }}
                  className="bg-slate-900 border border-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded-xl focus:outline-none"
                >
                  {tokens.map((t) => {
                    const tokenKey = t.id || `${t.symbol}-${t.network}`;
                    return (
                      <option key={tokenKey} value={tokenKey}>
                        {t.symbol} ({t.networkName || (t.network === 'polygon' ? 'Polygon' : 'Ethereum')})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Provider Picker */}
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Select Payment Partner
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'moonpay', name: 'MoonPay', fee: '1.5%' },
                  { id: 'banxa', name: 'Banxa', fee: '1.2%' },
                  { id: 'transak', name: 'Transak', fee: '1.8%' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPaymentProvider(p.id as any)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      paymentProvider === p.id
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold text-xs">{p.name}</div>
                    <div className="text-[10px] text-slate-500">Fee {p.fee}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Security Guarantee */}
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-cyan-500/5 border border-cyan-500/20 text-[11px] text-slate-300">
              <ShieldCheck className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span>Funds settle directly into your self-custody wallet address.</span>
            </div>

            <button
              id="buy-crypto-submit-btn"
              disabled={isProcessing || numFiat <= 0}
              onClick={handleBuy}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-sm shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2"
            >
              <CreditCard className="w-4 h-4" />
              <span>{isProcessing ? 'Connecting to Provider...' : `Buy ${selectedToken.symbol} Now`}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
