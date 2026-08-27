import React, { useState } from 'react';
import {
  ChevronDown,
  Wallet,
  Settings as SettingsIcon,
  ArrowLeftRight,
  LayoutDashboard,
  CheckCircle2,
  Copy,
  LogOut,
  Store,
  Receipt,
  CreditCard,
  ShieldCheck
} from 'lucide-react';
import { useAppKit } from '../hooks/useAppKit';
import { WalletAccount, NetworkType, UserSettings, Token } from '../types';
import { shortenAddress, formatCurrency } from '../utils/crypto';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';

interface NavbarProps {
  activeTab: 'swap' | 'pay' | 'merchant' | 'payments' | 'dashboard' | 'history' | 'earn' | 'admin';
  setActiveTab: (tab: 'swap' | 'pay' | 'merchant' | 'payments' | 'dashboard' | 'history' | 'earn' | 'admin') => void;
  wallet: WalletAccount | null;
  tokens?: Token[];
  totalPortfolioUsd?: number;
  settings: UserSettings;
  onOpenConnectModal: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  selectedNetwork: NetworkType;
  onChangeNetwork: (network: NetworkType) => void;
  onDisconnectWallet: () => void;
  onCopyAddress: (addr: string) => void;
}

const NETWORKS: { id: NetworkType; name: string; iconBg: string; short: string }[] = [
  { id: 'polygon', name: 'Polygon', iconBg: 'bg-purple-600', short: 'POL' },
  { id: 'ethereum', name: 'Ethereum', iconBg: 'bg-blue-600', short: 'ETH' },
  { id: 'bitcoincash', name: 'Bitcoin Cash', iconBg: 'bg-emerald-500', short: 'BCH' },
  { id: 'bitcoin', name: 'Bitcoin', iconBg: 'bg-amber-500', short: 'BTC' },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  wallet,
  tokens,
  totalPortfolioUsd,
  settings,
  onOpenConnectModal,
  onOpenSettings,
  selectedNetwork,
  onChangeNetwork,
  onDisconnectWallet,
  onCopyAddress,
}) => {
  const { open } = useAppKit();
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Exact live portfolio value computed consistently across the app
  const displayPortfolioValue = React.useMemo(() => {
    if (!wallet) return 0;
    if (typeof totalPortfolioUsd === 'number') return totalPortfolioUsd;
    if (tokens && tokens.length > 0) {
      return tokens.reduce((acc, t) => acc + (t.balance * (t.priceUsd || 0)), 0);
    }
    return wallet.portfolioBalanceUsd || 0;
  }, [wallet, totalPortfolioUsd, tokens]);

  const activeNetworkObj = NETWORKS.find((n) => n.id === selectedNetwork) || NETWORKS[0];

  const handleCopy = (addr: string) => {
    onCopyAddress(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenAccountModal = async () => {
    setWalletDropdownOpen(false);
    try {
      await open({ view: 'Account' });
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenNetworksModal = async () => {
    setNetworkDropdownOpen(false);
    try {
      await open({ view: 'Networks' });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDisconnect = async () => {
    setWalletDropdownOpen(false);
    try {
      await onDisconnectWallet();
    } catch (e) {
      console.warn('Navbar disconnect error:', e);
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl border-b transition-colors duration-200 border-slate-800/80 bg-slate-950/85 text-slate-100">
      {/* Invisible backdrop when dropdowns are open */}
      {(walletDropdownOpen || networkDropdownOpen) && (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={() => {
            setWalletDropdownOpen(false);
            setNetworkDropdownOpen(false);
          }}
        />
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        {/* Brand / Logo */}
        <div className="flex items-center gap-4 lg:gap-6">
          <button
            id="brand-logo-btn"
            onClick={() => setActiveTab('swap')}
            className="flex items-center gap-3 group text-left focus:outline-none shrink-0"
          >
            <div className="relative group-hover:scale-105 transition-transform duration-200">
              <img
                src={payFluxLogoSrc}
                alt="PayFlux"
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-xl object-cover border border-cyan-400/30 shadow-md shadow-cyan-950/80"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-tight">
                <span className="font-black text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-cyan-300 bg-clip-text text-transparent">
                  PayFlux
                </span>
                <span className="text-[9px] font-extrabold tracking-wider uppercase px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  PAY
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium hidden sm:block">
                Crypto Payments & Merchant Solutions
              </p>
            </div>
          </button>

          {/* Navigation Links - Desktop (Swap | Pay | Merchant | Ledger | Portfolio) */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-800/60">
            <button
              id="nav-swap-btn"
              onClick={() => setActiveTab('swap')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'swap'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-sm shadow-cyan-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Swap
            </button>
            <button
              id="nav-pay-btn"
              onClick={() => setActiveTab('pay')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'pay'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-sm shadow-cyan-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              Pay
            </button>
            <button
              id="nav-merchant-btn"
              onClick={() => setActiveTab('merchant')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'merchant'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-sm shadow-cyan-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              Merchant
            </button>
            <button
              id="nav-payments-btn"
              onClick={() => setActiveTab('payments')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'payments'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-sm shadow-cyan-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              Ledger
            </button>
            <button
              id="nav-dashboard-btn"
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-sm shadow-cyan-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Portfolio
            </button>
            <button
              id="nav-admin-btn"
              onClick={() => setActiveTab('admin')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'admin'
                  ? 'bg-gradient-to-r from-purple-500 to-cyan-400 text-slate-950 shadow-sm shadow-purple-500/30 font-black'
                  : 'text-purple-300 hover:text-white hover:bg-purple-950/40 border border-purple-500/20'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Admin
            </button>
          </nav>
        </div>

        {/* Right Section Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Connect Wallet Button / Wallet Info Dropdown */}

          {/* Wallet State Pill */}
          {wallet ? (
            <div className="relative">
              <button
                id="connected-wallet-btn"
                onClick={() => {
                  setWalletDropdownOpen(!walletDropdownOpen);
                  setNetworkDropdownOpen(false);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-cyan-500/30 hover:border-cyan-500/60 transition-all text-xs font-medium shadow-sm shadow-cyan-950/40"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-slate-200 font-bold">{shortenAddress(wallet.address, 3)}</span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 rounded-md bg-slate-800 text-[11px] text-cyan-300 font-semibold">
                  {formatCurrency(displayPortfolioValue, settings.currency, true)}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {walletDropdownOpen && (
                <div
                  id="wallet-dropdown-menu"
                  className="absolute right-0 mt-2 w-72 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-3 z-50 text-slate-200 animate-in fade-in zoom-in-95 duration-100"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold text-slate-950">
                        {wallet.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                          {wallet.name}
                          <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                            Connected
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {shortenAddress(wallet.address, 4)}
                        </div>
                      </div>
                    </div>
                    <button
                      id="wallet-copy-dropdown-btn"
                      onClick={() => handleCopy(wallet.address)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                      title="Copy Address"
                    >
                      {copied ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="py-2.5 border-b border-slate-800">
                    <div className="text-[11px] text-slate-400">Estimated Portfolio</div>
                    <div className="text-lg font-extrabold text-white">
                      {formatCurrency(displayPortfolioValue, settings.currency)}
                    </div>
                  </div>

                  <div className="pt-2 space-y-1">
                    <button
                      id="wallet-view-pay-btn"
                      onClick={() => {
                        setActiveTab('pay');
                        setWalletDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white font-medium"
                    >
                      <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
                      Pay a Merchant
                    </button>
                    <button
                      id="wallet-view-merchant-btn"
                      onClick={() => {
                        setActiveTab('merchant');
                        setWalletDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white font-medium"
                    >
                      <Store className="w-3.5 h-3.5 text-emerald-400" />
                      Merchant POS Hub
                    </button>
                    <button
                      id="wallet-view-dashboard-btn"
                      onClick={() => {
                        setActiveTab('dashboard');
                        setWalletDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white font-medium"
                    >
                      <LayoutDashboard className="w-3.5 h-3.5 text-cyan-400" />
                      View Portfolio Dashboard
                    </button>
                    <button
                      id="wallet-view-admin-btn"
                      onClick={() => {
                        setActiveTab('admin');
                        setWalletDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-purple-300 hover:bg-purple-950/40 hover:text-white font-medium"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                      PayFlux Admin & Swap Analytics
                    </button>
                    <button
                      id="wallet-open-appkit-modal-btn"
                      onClick={handleOpenAccountModal}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white font-medium"
                    >
                      <Wallet className="w-3.5 h-3.5 text-cyan-400" />
                      WalletConnect Account Details
                    </button>
                    <button
                      id="wallet-disconnect-btn"
                      onClick={handleDisconnect}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 font-medium"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Disconnect Wallet
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              id="header-connect-wallet-btn"
              onClick={onOpenConnectModal}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-bold shadow-md shadow-cyan-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Connect Wallet</span>
            </button>
          )}

          {/* PWA Install Button when available */}
          <PwaInstallBanner mode="navbar-button" />

          {/* Settings Trigger */}
          <button
            id="open-settings-btn"
            onClick={onOpenSettings}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

