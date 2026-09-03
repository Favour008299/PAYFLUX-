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
  ShieldCheck,
  Globe,
  Check
} from 'lucide-react';
import { useAppKit } from '../hooks/useAppKit';
import { WalletAccount, NetworkType, UserSettings, Token } from '../types';
import { shortenAddress, formatCurrency } from '../utils/crypto';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';
import { useTranslation } from '../i18n';

interface NavbarProps {
  activeTab: 'swap' | 'pay' | 'merchant' | 'payments' | 'dashboard' | 'history' | 'earn' | 'admin';
  setActiveTab: (tab: 'swap' | 'pay' | 'merchant' | 'payments' | 'dashboard' | 'history' | 'earn' | 'admin') => void;
  wallet: WalletAccount | null;
  tokens?: Token[];
  totalPortfolioUsd?: number;
  settings: UserSettings;
  onOpenConnectModal: () => void;
  onOpenSettings: (tab?: 'general' | 'analytics' | 'wallets' | 'security' | 'about' | 'admin') => void;
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
  const { t, language, setLanguage, languages } = useTranslation();
  const { open } = useAppKit();
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
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
      {(walletDropdownOpen || networkDropdownOpen || langDropdownOpen) && (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={() => {
            setWalletDropdownOpen(false);
            setNetworkDropdownOpen(false);
            setLangDropdownOpen(false);
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
                {t('brand.subtitle')}
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
              {t('nav.swap')}
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
              {t('nav.pay')}
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
              {t('nav.merchant')}
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
              {t('nav.portfolio')}
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
                            {t('nav.connected')}
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
                      title={t('common.copy')}
                    >
                      {copied ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="py-2.5 border-b border-slate-800">
                    <div className="text-[11px] text-slate-400">{t('nav.estimated_portfolio')}</div>
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
                      {t('nav.pay_merchant')}
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
                      {t('nav.merchant_pos_hub')}
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
                      {t('nav.view_portfolio')}
                    </button>
                    <button
                      id="wallet-view-admin-btn"
                      onClick={() => {
                        onOpenSettings('admin');
                        setWalletDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-purple-300 hover:bg-purple-950/40 hover:text-white font-medium"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                      {t('nav.admin_analytics')}
                    </button>
                    <button
                      id="wallet-open-appkit-modal-btn"
                      onClick={handleOpenAccountModal}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white font-medium"
                    >
                      <Wallet className="w-3.5 h-3.5 text-cyan-400" />
                      {t('nav.walletconnect_details')}
                    </button>
                    <button
                      id="wallet-disconnect-btn"
                      onClick={handleDisconnect}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 font-medium"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      {t('nav.disconnect_wallet')}
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
              <span>{t('nav.connect_wallet')}</span>
            </button>
          )}

          {/* Language Selector Dropdown */}
          <div className="relative">
            <button
              id="navbar-language-btn"
              onClick={() => {
                setLangDropdownOpen(!langDropdownOpen);
                setWalletDropdownOpen(false);
                setNetworkDropdownOpen(false);
              }}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors text-xs font-bold"
              title="Select Language"
            >
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              <span className="uppercase text-[11px] font-mono tracking-wider">{language}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {langDropdownOpen && (
              <div
                id="navbar-language-dropdown"
                className="absolute right-0 mt-2 w-44 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-800 shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800/80 mb-1">
                  {t('settings.language')}
                </div>
                {languages.map((lang) => {
                  const isSelected = language === lang.code;
                  return (
                    <button
                      key={lang.code}
                      id={`lang-select-${lang.code}`}
                      onClick={() => {
                        setLanguage(lang.code);
                        setLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors ${
                        isSelected
                          ? 'bg-cyan-500/15 text-cyan-300 font-bold'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <span>{lang.name}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Settings Trigger */}
          <button
            id="open-settings-btn"
            onClick={() => onOpenSettings('general')}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            title={t('settings.title')}
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

