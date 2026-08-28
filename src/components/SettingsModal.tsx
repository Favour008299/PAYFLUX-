import React, { useState, useEffect } from 'react';
import {
  X,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Globe,
  DollarSign,
  Shield,
  Bell,
  Wallet,
  Info,
  ExternalLink,
  Lock,
  LogOut,
  Sparkles,
  Zap,
  Check,
  Key,
  RotateCcw,
  Download,
  BarChart3,
  Copy,
  TrendingUp,
  Activity
} from 'lucide-react';
import { UserSettings, WalletAccount } from '../types';
import { FIAT_RATES } from '../data/tokens';
import { shortenAddress } from '../utils/crypto';
import { projectId } from '../config/web3';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  wallet: WalletAccount | null;
  onDisconnectWallet: () => void;
  onOpenConnectModal: () => void;
}

const LANGUAGES = [
  { code: 'en', name: 'English (US)' },
  { code: 'es', name: 'Español' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文 (简体)' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  wallet,
  onDisconnectWallet,
  onOpenConnectModal,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'analytics' | 'wallets' | 'security' | 'about'>('general');
  const [selectedLang, setSelectedLang] = useState('en');
  const [customProjectId, setCustomProjectId] = useState('');
  const [projectIdSaved, setProjectIdSaved] = useState(false);
  const [copiedAnalyticsLink, setCopiedAnalyticsLink] = useState(false);

  const ANALYTICS_URL = 'https://analytics.vgdh.io/payflux-orcin.vercel.app';

  const handleCopyAnalyticsLink = () => {
    navigator.clipboard.writeText(ANALYTICS_URL);
    setCopiedAnalyticsLink(true);
    setTimeout(() => setCopiedAnalyticsLink(false), 2000);
  };

  const handleOpenAnalytics = () => {
    window.open(ANALYTICS_URL, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('verseswap_wc_project_id');
      setCustomProjectId(saved || projectId);
    }
  }, [isOpen]);

  const handleSaveProjectId = () => {
    if (typeof window !== 'undefined') {
      if (customProjectId.trim()) {
        localStorage.setItem('verseswap_wc_project_id', customProjectId.trim());
      } else {
        localStorage.removeItem('verseswap_wc_project_id');
      }
      setProjectIdSaved(true);
      setTimeout(() => setProjectIdSaved(false), 2500);
    }
  };

  const handleResetProjectId = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('verseswap_wc_project_id');
      setCustomProjectId('1719c40614624ba8e3aa822db13c631d');
      setProjectIdSaved(true);
      setTimeout(() => setProjectIdSaved(false), 2500);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="settings-modal"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <SettingsIcon className="w-4 h-4 text-cyan-400" />
            </div>
            <h3 className="font-extrabold text-base text-white">Settings</h3>
          </div>
          <button
            id="close-settings-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-4 pt-3 flex items-center gap-1 border-b border-slate-800 text-xs overflow-x-auto no-scrollbar">
          <button
            id="settings-tab-general"
            onClick={() => setActiveTab('general')}
            className={`px-3 py-2 rounded-t-xl font-bold transition-colors shrink-0 ${
              activeTab === 'general'
                ? 'bg-slate-800 text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Preferences
          </button>
          <button
            id="settings-tab-analytics"
            onClick={() => setActiveTab('analytics')}
            className={`px-3 py-2 rounded-t-xl font-bold transition-colors shrink-0 flex items-center gap-1.5 ${
              activeTab === 'analytics'
                ? 'bg-slate-800 text-emerald-400 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Analytics</span>
          </button>
          <button
            id="settings-tab-wallets"
            onClick={() => setActiveTab('wallets')}
            className={`px-3 py-2 rounded-t-xl font-bold transition-colors shrink-0 ${
              activeTab === 'wallets'
                ? 'bg-slate-800 text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Wallets
          </button>
          <button
            id="settings-tab-security"
            onClick={() => setActiveTab('security')}
            className={`px-3 py-2 rounded-t-xl font-bold transition-colors shrink-0 ${
              activeTab === 'security'
                ? 'bg-slate-800 text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Security & Gas
          </button>
          <button
            id="settings-tab-about"
            onClick={() => setActiveTab('about')}
            className={`px-3 py-2 rounded-t-xl font-bold transition-colors shrink-0 ${
              activeTab === 'about'
                ? 'bg-slate-800 text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            About
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* GENERAL PREFERENCES TAB */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              {/* Live Analytics Quick Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-950 border border-emerald-500/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <BarChart3 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      PayFlux Live Analytics
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Real-time visitor & payment telemetry dashboard
                    </div>
                  </div>
                </div>
                <button
                  id="settings-quick-open-analytics-btn"
                  onClick={handleOpenAnalytics}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-emerald-500/20 active:scale-95"
                >
                  <span>Open</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Currency Selector */}
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-2">
                  <DollarSign className="w-4 h-4 text-cyan-400" />
                  <span>Display Currency</span>
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {Object.entries(FIAT_RATES).map(([curr, cfg]) => (
                    <button
                      key={curr}
                      onClick={() =>
                        onUpdateSettings({
                          currency: curr as UserSettings['currency'],
                        })
                      }
                      className={`p-2 rounded-xl text-xs font-bold border transition-all ${
                        settings.currency === curr
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="font-mono">{curr} ({cfg.symbol})</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Language Selector */}
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <span>Language</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLang(lang.code)}
                      className={`p-2.5 rounded-xl text-xs font-medium text-left border flex items-center justify-between transition-all ${
                        selectedLang === lang.code
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span>{lang.name}</span>
                      {selectedLang === lang.code && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme Settings */}
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-200">Theme Mode</div>
                  <div className="text-[11px] text-slate-400">Dark Web3 theme (Default) or Light theme</div>
                </div>
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => onUpdateSettings({ theme: 'dark' })}
                    className={`p-2 rounded-lg text-xs font-bold flex items-center gap-1 ${
                      settings.theme === 'dark'
                        ? 'bg-slate-800 text-cyan-400 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span>Dark</span>
                  </button>
                  <button
                    onClick={() => onUpdateSettings({ theme: 'light' })}
                    className={`p-2 rounded-lg text-xs font-bold flex items-center gap-1 ${
                      settings.theme === 'light'
                        ? 'bg-slate-800 text-cyan-400 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    <span>Light</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DEDICATED LIVE ANALYTICS TAB */}
          {activeTab === 'analytics' && (
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/60 via-slate-900 to-slate-950 border border-emerald-500/40 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <BarChart3 className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-sm font-extrabold text-white flex items-center gap-2">
                        PayFlux Telemetry & Analytics
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          LIVE
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        Domain: <span className="font-mono text-cyan-300">payflux-orcin.vercel.app</span>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Real-time visitor telemetry, on-chain checkout completions, swap operations, and customer payment traffic tracked securely via <span className="font-mono text-emerald-300">analytics.vgdh.io</span>.
                </p>

                {/* Clickable Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <button
                    id="settings-open-live-analytics-action-btn"
                    onClick={handleOpenAnalytics}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-extrabold text-xs shadow-lg shadow-emerald-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Activity className="w-4 h-4 text-slate-950" />
                    <span>Launch Live Analytics</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-950" />
                  </button>

                  <button
                    id="settings-copy-analytics-url-btn"
                    onClick={handleCopyAnalyticsLink}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs transition-all active:scale-[0.98]"
                  >
                    {copiedAnalyticsLink ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span className="text-emerald-300">Copied URL!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-slate-400" />
                        <span>Copy Analytics URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Monitored Metrics Details */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-cyan-400" />
                  <span>Monitored Telemetry Streams</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400">Visitor Traffic</div>
                    <div className="text-sm font-extrabold text-white mt-0.5">Real-time Visitors</div>
                    <div className="text-[10px] text-emerald-400 mt-1">● Active session tracking</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400">Checkout Conversions</div>
                    <div className="text-sm font-extrabold text-white mt-0.5">Payment Funnel</div>
                    <div className="text-[10px] text-cyan-400 mt-1">● QR scan & settlements</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400">Swap Volume</div>
                    <div className="text-sm font-extrabold text-white mt-0.5">DEX Operations</div>
                    <div className="text-[10px] text-purple-400 mt-1">● On-chain routes</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400">Merchant Hub</div>
                    <div className="text-sm font-extrabold text-white mt-0.5">Invoices & POS</div>
                    <div className="text-[10px] text-amber-400 mt-1">● Setup creations</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* WALLETS MANAGEMENT TAB */}
          {activeTab === 'wallets' && (
            <div className="space-y-4">
              {wallet ? (
                <div className="p-4 rounded-2xl bg-slate-950/90 border border-cyan-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-cyan-500 flex items-center justify-center text-slate-950 font-black">
                        V
                      </div>
                      <div>
                        <div className="font-bold text-xs text-white">{wallet.name}</div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {shortenAddress(wallet.address, 6)}
                        </div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                      Active
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-400">Network</span>
                    <span className="text-white font-semibold uppercase">{wallet.network}</span>
                  </div>

                  <button
                    onClick={() => {
                      onDisconnectWallet();
                      onClose();
                    }}
                    className="w-full py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Disconnect Wallet</span>
                  </button>
                </div>
              ) : (
                <div className="p-6 rounded-2xl bg-slate-950 text-center border border-slate-800">
                  <Wallet className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400 mb-3">No wallet connected</p>
                  <button
                    onClick={() => {
                      onClose();
                      onOpenConnectModal();
                    }}
                    className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md"
                  >
                    Connect Wallet
                  </button>
                </div>
              )}

              {/* Reown AppKit & WalletConnect Cloud Settings */}
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                      <Key className="w-3.5 h-3.5 text-cyan-400" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">WalletConnect Project ID</div>
                      <div className="text-[10px] text-slate-400">Reown Cloud Relay & Multi-chain pairing</div>
                    </div>
                  </div>
                  <a
                    href="https://cloud.reown.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    <span>Get ID</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customProjectId}
                    onChange={(e) => setCustomProjectId(e.target.value)}
                    placeholder="Enter 32-character Project ID"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    onClick={handleSaveProjectId}
                    className="px-3 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors"
                  >
                    {projectIdSaved ? 'Saved' : 'Save'}
                  </button>
                  <button
                    onClick={handleResetProjectId}
                    title="Reset to default Project ID"
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {projectIdSaved && (
                  <div className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                    <Check className="w-3 h-3" />
                    <span>Project ID updated. Reload or reconnect to apply changes.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECURITY & GAS TAB */}
          {activeTab === 'security' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white">Default Gas Speed</div>
                    <div className="text-[11px] text-slate-400">Priority fee presets</div>
                  </div>
                  <div className="flex gap-1">
                    {(['eco', 'standard', 'fast'] as const).map((spd) => (
                      <button
                        key={spd}
                        onClick={() => onUpdateSettings({ gasSpeed: spd })}
                        className={`px-2.5 py-1 rounded-lg font-bold capitalize ${
                          settings.gasSpeed === spd
                            ? 'bg-cyan-500 text-slate-950'
                            : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        {spd}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white">Auto-Lock Timer</div>
                    <div className="text-[11px] text-slate-400">Lock wallet after inactivity</div>
                  </div>
                  <select
                    value={settings.autoLockMinutes}
                    onChange={(e) =>
                      onUpdateSettings({ autoLockMinutes: parseInt(e.target.value) })
                    }
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-white font-medium focus:outline-none"
                  >
                    <option value={5}>5 Minutes</option>
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={0}>Never</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ABOUT TAB */}
          {activeTab === 'about' && (
            <div className="space-y-4 text-xs">
              <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 text-center">
                <div className="flex justify-center">
                  <img
                    src={payFluxLogoSrc}
                    alt="PayFlux"
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 rounded-2xl object-cover border border-cyan-400/40 shadow-xl shadow-cyan-950/80"
                  />
                </div>
                <h4 className="text-base font-extrabold text-white">PayFlux</h4>
                <p className="text-xs text-cyan-300 font-semibold">Pay Your Way. Merchants Get Theirs.</p>
                <p className="text-[11px] text-slate-400 leading-relaxed max-w-sm mx-auto">
                  Pay with crypto. Get paid with ease. PayFlux connects customers and merchants through simple, secure crypto payments, while making it easy to pay, receive, and track transactions in one place.
                </p>
                <div className="pt-2 flex items-center justify-center gap-3">
                  <a
                    href="https://debridge.finance"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-purple-400 hover:underline font-bold"
                  >
                    <span>deBridge DLN</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <span>•</span>
                  <a
                    href="https://polygonscan.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-cyan-400 hover:underline font-bold"
                  >
                    <span>Polygonscan</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
