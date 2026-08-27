import React, { useState, useMemo } from 'react';
import {
  Wallet,
  ArrowLeftRight,
  Send,
  QrCode,
  Clock,
  Coins,
  TrendingUp,
  TrendingDown,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  CreditCard,
  ChevronRight,
  ShieldCheck,
  Search,
  Star,
  LogOut,
  Store,
  Receipt,
  Layers
} from 'lucide-react';
import { Token, WalletAccount, TransactionRecord, UserSettings } from '../types';
import { formatCurrency, formatTokenPrice, formatTokenAmount, shortenAddress, timeAgo } from '../utils/crypto';
import { TokenIcon } from './TokenIcon';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';

interface HomeDashboardProps {
  wallet: WalletAccount | null;
  tokens: Token[];
  totalPortfolioUsd?: number;
  transactions: TransactionRecord[];
  settings: UserSettings;
  onNavigateTab: (tab: 'swap' | 'pay' | 'merchant' | 'payments' | 'dashboard' | 'history' | 'earn' | 'admin') => void;
  onOpenSend: () => void;
  onOpenReceive: () => void;
  onOpenBuyCrypto: () => void;
  onOpenConnectModal: () => void;
  onOpenExplorer: (tx: TransactionRecord) => void;
  onSelectTokenToSwap: (token: Token) => void;
  onDisconnectWallet?: () => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  wallet,
  tokens,
  totalPortfolioUsd: propTotalPortfolioUsd,
  transactions,
  settings,
  onNavigateTab,
  onOpenSend,
  onOpenReceive,
  onOpenBuyCrypto,
  onOpenConnectModal,
  onOpenExplorer,
  onSelectTokenToSwap,
  onDisconnectWallet,
}) => {
  const [copied, setCopied] = useState(false);
  const [assetFilter, setAssetFilter] = useState<'all' | 'polygon' | 'ethereum' | 'nonZero'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Dynamically compute real portfolio value from live token balances and prices
  const computedTotalPortfolioUsd = useMemo(() => {
    if (!wallet) return 0;
    if (typeof propTotalPortfolioUsd === 'number') return propTotalPortfolioUsd;
    return tokens.reduce((acc, t) => {
      const price = t.priceUsd || 0;
      return acc + (t.balance * price);
    }, 0);
  }, [wallet, tokens, propTotalPortfolioUsd]);

  const totalPortfolioUsd = computedTotalPortfolioUsd;

  const nonZeroCount = useMemo(() => {
    return tokens.filter((t) => t.balance > 0).length;
  }, [tokens]);

  const portfolio24hChange = 4.38; // +4.38%

  const handleCopy = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredTokens = useMemo(() => {
    const list = tokens.filter((t) => {
      const matchesSearch =
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.network.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (assetFilter === 'polygon') return t.network === 'polygon';
      if (assetFilter === 'ethereum') return t.network === 'ethereum';
      if (assetFilter === 'nonZero') return t.balance > 0;
      return true;
    });

    // Sort tokens: tokens with user balance > 0 appear at the top, sorted by USD value descending
    return [...list].sort((a, b) => {
      const aVal = a.balance * (a.priceUsd || 0);
      const bVal = b.balance * (b.priceUsd || 0);
      if (aVal > 0 || bVal > 0) {
        if (bVal !== aVal) return bVal - aVal;
        return b.balance - a.balance;
      }
      if (a.balance > 0 && b.balance === 0) return -1;
      if (b.balance > 0 && a.balance === 0) return 1;
      return 0;
    });
  }, [tokens, searchQuery, assetFilter]);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 pb-12">
      {/* Portfolio Master Header Card */}
      <div
        id="portfolio-card"
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 p-5 sm:p-7 shadow-2xl text-slate-100"
      >
        {/* Glow orb */}
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          {/* Portfolio Balance & 24h PnL */}
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              <span>Total Portfolio Value</span>
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-bold text-[10px]">
                Live On-Chain
              </span>
            </div>
            <div className="flex items-baseline gap-3">
              <div className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                {formatCurrency(totalPortfolioUsd, settings.currency)}
              </div>
              <div className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>+{portfolio24hChange}% (24h)</span>
              </div>
            </div>
          </div>

          {/* Connected Address & Network Badge */}
          {wallet ? (
            <div className="flex items-center gap-2">
              <div className="p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{shortenAddress(wallet.address, 4)}</span>
                <button
                  id="dashboard-copy-addr-btn"
                  onClick={() => handleCopy(wallet.address)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                  title="Copy address"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              {onDisconnectWallet && (
                <button
                  id="dashboard-disconnect-wallet-btn"
                  onClick={onDisconnectWallet}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:text-rose-300 text-xs font-bold transition-colors shadow-sm"
                  title="Disconnect wallet"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Disconnect</span>
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={onOpenConnectModal}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md"
            >
              Connect Wallet
            </button>
          )}
        </div>

        {/* Quick Action Buttons */}
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 sm:gap-3 pt-2">
          {/* Swap */}
          <button
            id="quick-swap-btn"
            onClick={() => onNavigateTab('swap')}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-gradient-to-b from-cyan-500/20 to-cyan-500/5 hover:from-cyan-500/30 hover:to-cyan-500/10 border border-cyan-500/30 text-cyan-300 transition-all hover:scale-[1.03] active:scale-[0.97]"
          >
            <div className="w-10 h-10 rounded-2xl bg-cyan-500 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/30 mb-1.5">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-white">Swap</span>
          </button>

          {/* Send */}
          <button
            id="quick-send-btn"
            onClick={wallet ? onOpenSend : onOpenConnectModal}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 transition-all hover:scale-[1.03] active:scale-[0.97]"
          >
            <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-cyan-400 mb-1.5">
              <Send className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold">Send</span>
          </button>

          {/* Receive */}
          <button
            id="quick-receive-btn"
            onClick={onOpenReceive}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 transition-all hover:scale-[1.03] active:scale-[0.97]"
          >
            <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-emerald-400 mb-1.5">
              <QrCode className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold">Receive</span>
          </button>

          {/* History */}
          <button
            id="quick-history-btn"
            onClick={() => onNavigateTab('history')}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 transition-all hover:scale-[1.03] active:scale-[0.97]"
          >
            <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-purple-400 mb-1.5">
              <Clock className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold">History</span>
          </button>

          {/* Buy Fiat Onramp */}
          <button
            id="quick-buy-btn"
            onClick={onOpenBuyCrypto}
            className="hidden sm:flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 transition-all hover:scale-[1.03] active:scale-[0.97]"
          >
            <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-amber-400 mb-1.5">
              <CreditCard className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold">Buy Crypto</span>
          </button>
        </div>
      </div>

      {/* PayFlux Merchant & Payments Highlight */}
      <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-purple-950/50 via-slate-900 to-cyan-950/40 border border-purple-500/30 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <img
            src={payFluxLogoSrc}
            alt="PayFlux"
            referrerPolicy="no-referrer"
            className="w-12 h-12 rounded-2xl object-cover border border-cyan-400/40 shadow-lg shadow-cyan-950/60 flex-shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm text-white">Merchant POS & Invoicing</span>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300">
                0% Gateway Fees
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Create instant on-chain payment QR codes and settle funds directly to your connected wallet.
            </p>
          </div>
        </div>

        <button
          onClick={() => onNavigateTab('merchant')}
          className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-bold text-xs transition-all flex items-center justify-center gap-1.5 flex-shrink-0 shadow-md"
        >
          <span>Open Merchant Hub</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Main Assets Breakdown List */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl text-slate-100">
        {/* Assets Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h3 className="font-extrabold text-base text-white">Multi-Chain Assets</h3>
            <span className="text-xs text-slate-400 font-mono">({filteredTokens.length})</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-32 sm:w-40"
              />
            </div>

            {/* Filter pills */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setAssetFilter('all')}
                className={`px-2 py-1 rounded-lg font-semibold transition-colors ${
                  assetFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setAssetFilter('polygon')}
                className={`px-2 py-1 rounded-lg font-semibold transition-colors ${
                  assetFilter === 'polygon' ? 'bg-purple-500/30 text-purple-300' : 'text-slate-400'
                }`}
              >
                Polygon
              </button>
              <button
                onClick={() => setAssetFilter('ethereum')}
                className={`px-2 py-1 rounded-lg font-semibold transition-colors ${
                  assetFilter === 'ethereum' ? 'bg-blue-500/30 text-blue-300' : 'text-slate-400'
                }`}
              >
                Ethereum
              </button>
              <button
                onClick={() => setAssetFilter('nonZero')}
                className={`px-2 py-1 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
                  assetFilter === 'nonZero' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>Holdings</span>
                {nonZeroCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-black">
                    {nonZeroCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Tokens Table */}
        <div className="divide-y divide-slate-800/60 overflow-hidden">
          {filteredTokens.map((token) => {
            const tokenKey = token.id || `${token.symbol}-${token.network}`;
            const balanceUsd = token.balance * token.priceUsd;
            const isPositive = token.change24h >= 0;

            return (
              <div
                key={tokenKey}
                id={`asset-row-${tokenKey}`}
                className="flex items-center justify-between py-3.5 px-2 hover:bg-slate-800/50 rounded-2xl transition-colors group"
              >
                {/* Left: Token info */}
                <div className="flex items-center gap-3 min-w-0">
                  <TokenIcon token={token} size="lg" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white text-sm">{token.symbol}</span>
                      {/* Network pill */}
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                          token.network === 'polygon'
                            ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                            : token.network === 'ethereum'
                            ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {token.networkName || (token.network === 'polygon' ? 'Polygon' : 'Ethereum')}
                      </span>
                      <span className="text-xs text-slate-400 truncate hidden sm:inline">
                        {token.name}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-400">
                      {formatTokenPrice(token, settings.currency)}
                      {!token.isPriceUnavailable && token.priceUsd > 0 && (
                        <span
                          className={`ml-2 text-[11px] font-bold ${
                            isPositive ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isPositive ? '+' : ''}
                          {token.change24h}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: User Balance & Action */}
                <div className="flex items-center gap-3 text-right">
                  <div>
                    <div className="font-mono font-bold text-sm text-white">
                      {formatTokenAmount(token.balance)} {token.symbol}
                    </div>
                    <div className="text-xs font-mono text-slate-400">
                      {token.isPriceUnavailable || !token.priceUsd
                        ? '—'
                        : formatCurrency(balanceUsd, settings.currency)}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onSelectTokenToSwap(token);
                      onNavigateTab('swap');
                    }}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-300 transition-all font-bold text-xs opacity-0 group-hover:opacity-100 hidden sm:flex items-center gap-1"
                    title={`Swap ${token.symbol}`}
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>Swap</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Activity Quick Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl text-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-base text-white">Recent Activity</h3>
          <button
            onClick={() => onNavigateTab('history')}
            className="text-xs text-cyan-400 hover:underline font-bold flex items-center gap-1"
          >
            <span>View All History</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-800/60">
          {transactions.slice(0, 3).map((tx, idx) => (
            <div
              key={`${tx.id}-${idx}`}
              onClick={() => onOpenExplorer(tx)}
              className="py-3 px-2 flex items-center justify-between hover:bg-slate-800/50 rounded-2xl cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-cyan-400">
                  {tx.type === 'swap' ? (
                    <ArrowLeftRight className="w-4 h-4" />
                  ) : tx.type === 'send' ? (
                    <Send className="w-4 h-4" />
                  ) : (
                    <QrCode className="w-4 h-4 text-emerald-400" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-white capitalize">
                    {tx.type === 'swap'
                      ? `Swapped ${tx.fromTokenSymbol} → ${tx.toTokenSymbol}`
                      : `${tx.type} ${tx.tokenSymbol}`}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {timeAgo(tx.timestamp)} • Status:{' '}
                    <span
                      className={`font-semibold uppercase text-[10px] ${
                        tx.status === 'completed'
                          ? 'text-emerald-400'
                          : tx.status === 'pending'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {tx.status === 'completed' ? 'Success' : tx.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs font-bold font-mono text-cyan-300">
                  {tx.type === 'swap'
                    ? `+${tx.toAmount} ${tx.toTokenSymbol}`
                    : `${tx.amount} ${tx.tokenSymbol}`}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {tx.hash && tx.hash !== 'pending' ? shortenAddress(tx.hash, 4) : tx.status === 'pending' ? 'Pending' : 'Pre-flight'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PayFlux Admin & Swap Analytics Quick Access Banner */}
      <div className="p-4 rounded-3xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-white">PayFlux Administrative Console & Swap Analytics</span>
            <p className="text-[11px] text-slate-400">View real-time swap confirmations, DEX trading volume, and access control.</p>
          </div>
        </div>
        <button
          onClick={() => onNavigateTab('admin')}
          className="px-3.5 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-bold transition-all whitespace-nowrap self-end sm:self-auto"
        >
          Open Admin Portal →
        </button>
      </div>
    </div>
  );
};
