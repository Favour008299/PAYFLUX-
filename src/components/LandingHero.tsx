import React from 'react';
import {
  Zap,
  Shield,
  ArrowRight,
  Sparkles,
  Lock,
  Coins,
  CheckCircle,
  PlusCircle,
  Wallet,
  CreditCard,
  Store,
  Receipt,
  ArrowLeftRight
} from 'lucide-react';
import { Token } from '../types';
import { formatCurrency } from '../utils/crypto';
import { TokenIcon } from './TokenIcon';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';

interface LandingHeroProps {
  tokens: Token[];
  currency: string;
  onConnectWallet: () => void;
  onCreateWallet: () => void;
  onExploreDirectly: () => void;
}

export const LandingHero: React.FC<LandingHeroProps> = ({
  tokens,
  currency,
  onConnectWallet,
  onCreateWallet,
  onExploreDirectly,
}) => {
  return (
    <div className="relative overflow-hidden pt-6 pb-14 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-center">
      {/* Background glow orb */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[32rem] h-[32rem] bg-gradient-to-tr from-purple-600/15 via-cyan-500/15 to-blue-600/10 blur-3xl -z-10 pointer-events-none rounded-full" />

      {/* App Logo Display */}
      <div className="flex justify-center mb-6">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-blue-500 rounded-3xl blur opacity-40 group-hover:opacity-75 transition duration-300" />
          <img
            src={payFluxLogoSrc}
            alt="PayFlux Logo"
            referrerPolicy="no-referrer"
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover object-center relative border border-cyan-400/40 shadow-2xl shadow-cyan-950/80 group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      </div>

      {/* Badge */}
      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-xs font-semibold mb-6 shadow-sm shadow-cyan-950">
        <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
        <span>Crypto Payments • Built for Merchants</span>
      </div>

      {/* Main Headline */}
      <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white mb-4 leading-tight">
        Pay Your Way.{' '}
        <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-purple-400 bg-clip-text text-transparent">
          Merchants Get Theirs.
        </span>
      </h1>

      {/* Description */}
      <p className="max-w-2xl mx-auto text-sm sm:text-base lg:text-lg text-slate-300 mb-8 leading-relaxed">
        Pay with crypto. Get paid with ease. PayFlux connects customers and merchants through simple, secure crypto payments, while making it easy to pay, receive, and track transactions in one place.
      </p>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 max-w-md mx-auto mb-12">
        <button
          id="hero-connect-wallet-btn"
          onClick={onConnectWallet}
          className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-400 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-extrabold text-sm shadow-lg shadow-cyan-500/25 hover:shadow-purple-500/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Wallet className="w-4 h-4 text-slate-950" />
          <span>Connect Wallet</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>

        <button
          id="hero-create-wallet-btn"
          onClick={onCreateWallet}
          className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 text-white font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <PlusCircle className="w-4 h-4 text-cyan-400" />
          <span>Create Wallet</span>
        </button>
      </div>

      {/* Platform Pillars */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 max-w-4xl mx-auto text-left mb-10">
        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-sm hover:border-cyan-500/30 transition-colors">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-2.5">
            <CreditCard className="w-4 h-4 text-cyan-400" />
          </div>
          <h2 className="text-xs font-bold text-white mb-1">Simple Payments</h2>
          <p className="text-[11px] text-slate-400 leading-normal">
            Pay any merchant invoice instantly with POL, USDT, USDC, or VERSE.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-sm hover:border-emerald-500/30 transition-colors">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-2.5">
            <Store className="w-4 h-4 text-emerald-400" />
          </div>
          <h2 className="text-xs font-bold text-white mb-1">Merchant Hub</h2>
          <p className="text-[11px] text-slate-400 leading-normal">
            Create QR payment links, receive customer funds, and settle directly to your wallet.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-sm hover:border-purple-500/30 transition-colors">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center mb-2.5">
            <Receipt className="w-4 h-4 text-purple-400" />
          </div>
          <h2 className="text-xs font-bold text-white mb-1">On-Chain Ledger</h2>
          <p className="text-[11px] text-slate-400 leading-normal">
            Track real on-chain transaction records and verified payment receipts in one place.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-sm hover:border-blue-500/30 transition-colors">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center mb-2.5">
            <ArrowLeftRight className="w-4 h-4 text-blue-400" />
          </div>
          <h2 className="text-xs font-bold text-white mb-1">Real DEX Swaps</h2>
          <p className="text-[11px] text-slate-400 leading-normal">
            Exchange tokens seamlessly across chains via deBridge DLN infrastructure.
          </p>
        </div>
      </div>

      {/* Supported Assets */}
      <div className="pt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Supported Multi-Chain Payment Assets
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {tokens.slice(0, 6).map((t) => {
            const tokenKey = t.id || `${t.symbol}-${t.network}`;
            return (
              <div
                key={tokenKey}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800/90 text-xs font-medium text-slate-200"
              >
                <TokenIcon token={t} size="xs" />
                <span className="font-bold text-white">{t.symbol}</span>
                <span className="text-[9px] font-semibold text-slate-400 uppercase">({t.network === 'polygon' ? 'POL' : 'ETH'})</span>
                <span className="text-slate-400 font-mono">
                  {formatCurrency(t.priceUsd, currency)}
                </span>
                <span
                  className={`text-[10px] font-semibold ${
                    t.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {t.change24h >= 0 ? '+' : ''}
                  {t.change24h}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
