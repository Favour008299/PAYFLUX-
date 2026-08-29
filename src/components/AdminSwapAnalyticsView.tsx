import React, { useState, useEffect } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  Users,
  DollarSign,
  TrendingUp,
  Search,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  Layers,
  ArrowUpRight,
  Filter,
  Clock,
  Ban,
  Slash
} from 'lucide-react';
import {
  SwapAnalyticsSummary,
  SwapTransactionRecord,
  SwapPairStat,
} from '../types';
import {
  getSwapAnalyticsSummary,
  subscribeToSwapAnalytics,
  syncSwapsFromFirestore,
} from '../services/swapAnalyticsService';
import { shortenAddress } from '../utils/crypto';
import { getExplorerTxUrl } from '../services/contractConfig';

export const AdminSwapAnalyticsView: React.FC = () => {
  const [summary, setSummary] = useState<SwapAnalyticsSummary>(getSwapAnalyticsSummary());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'pending' | 'failed' | 'rejected' | 'cancelled'>('all');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = () => {
    setSummary(getSwapAnalyticsSummary());
  };

  useEffect(() => {
    loadData();
    const unsub = subscribeToSwapAnalytics(() => {
      loadData();
    });

    // Also pull latest records from Firestore immediately on mount
    syncSwapsFromFirestore().then(() => {
      loadData();
    });

    // Periodic sync interval so telemetry stays updated even across multi-device sessions
    const interval = setInterval(() => {
      syncSwapsFromFirestore().then(() => {
        loadData();
      });
    }, 6000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await syncSwapsFromFirestore();
    loadData();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleCopy = (text: string, type: 'hash' | 'address') => {
    navigator.clipboard.writeText(text);
    if (type === 'hash') {
      setCopiedHash(text);
      setTimeout(() => setCopiedHash(null), 2000);
    } else {
      setCopiedAddress(text);
      setTimeout(() => setCopiedAddress(null), 2000);
    }
  };

  // Filtered swap records
  const filteredSwaps = summary.recentSwaps.filter((rec) => {
    if (statusFilter !== 'all') {
      if (statusFilter === 'failed') {
        // 'failed' filter shows reverted or execution failed
        if (rec.status !== 'failed') return false;
      } else if (rec.status !== statusFilter) {
        return false;
      }
    }
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase().trim();
    const matchesUser = (rec.userAddress || '').toLowerCase().includes(q);
    const matchesFrom = (rec.fromTokenSymbol || '').toLowerCase().includes(q);
    const matchesTo = (rec.toTokenSymbol || '').toLowerCase().includes(q);
    const matchesPair = (rec.pair || '').toLowerCase().includes(q);
    const matchesHash = (rec.txHash || '').toLowerCase().includes(q);
    const matchesReason = (rec.failureReason || '').toLowerCase().includes(q);
    const matchesNetwork = (rec.network || '').toLowerCase().includes(q);

    return matchesUser || matchesFrom || matchesTo || matchesPair || matchesHash || matchesReason || matchesNetwork;
  });

  const successRate =
    summary.totalAttempts > 0
      ? ((summary.successfulSwaps / summary.totalAttempts) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="space-y-6">
      {/* Top Section Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden shadow-xl">
        <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 shadow-md">
              <ArrowRightLeft className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white">Private Swap Analytics & DEX Telemetry</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Persistent Ledger
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Admin Only</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Authentic on-chain DEX swaps and cross-chain execution telemetry stored persistently in Firestore.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700 disabled:opacity-50 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Refresh Telemetry</span>
            </button>
          </div>
        </div>
      </div>

      {/* Primary KPI Metrics Grid (Calculated directly from persistent records) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3.5">
        {/* Total Attempts */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-1 shadow-lg">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>Total Attempts</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white font-mono">
            {summary.totalAttempts}
          </div>
          <div className="text-[11px] text-slate-400">Total swap attempts</div>
        </div>

        {/* Successful Swaps */}
        <div className="bg-slate-900 border border-emerald-500/30 p-4 rounded-2xl space-y-1 shadow-lg shadow-emerald-950/20">
          <div className="text-[10px] uppercase font-bold text-emerald-300 tracking-wider flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Successful Swaps</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
            {summary.successfulSwaps}
          </div>
          <div className="text-[11px] text-emerald-300/80 font-medium">
            {successRate}% success rate
          </div>
        </div>

        {/* Pending Swaps */}
        <div className="bg-slate-900 border border-amber-500/30 p-4 rounded-2xl space-y-1 shadow-lg shadow-amber-950/20">
          <div className="text-[10px] uppercase font-bold text-amber-300 tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Pending Swaps</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
            {summary.pendingSwaps || 0}
          </div>
          <div className="text-[11px] text-amber-300/80 font-medium">In flight or mining</div>
        </div>

        {/* Failed / Reverted Swaps */}
        <div className="bg-slate-900 border border-rose-500/30 p-4 rounded-2xl space-y-1 shadow-lg shadow-rose-950/20">
          <div className="text-[10px] uppercase font-bold text-rose-300 tracking-wider flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>Failed Swaps</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-rose-400 font-mono">
            {summary.failedSwaps}
          </div>
          <div className="text-[11px] text-slate-400">Reverted or rejected</div>
        </div>

        {/* Unique Swappers */}
        <div className="bg-slate-900 border border-purple-500/30 p-4 rounded-2xl space-y-1 shadow-lg">
          <div className="text-[10px] uppercase font-bold text-purple-300 tracking-wider flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-purple-400" />
            <span>Unique Swappers</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-purple-300 font-mono">
            {summary.uniqueUsersCount}
          </div>
          <div className="text-[11px] text-slate-400">Distinct wallets</div>
        </div>

        {/* Swap Volume */}
        <div className="bg-slate-900 border border-cyan-500/30 p-4 rounded-2xl space-y-1 shadow-lg">
          <div className="text-[10px] uppercase font-bold text-cyan-300 tracking-wider flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
            <span>Swap Volume</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white font-mono truncate">
            ${summary.totalSwapVolumeUsd.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-400">Settled USD volume</div>
        </div>

        {/* Swap Fees Collected */}
        <div className="bg-slate-900 border border-emerald-500/30 p-4 rounded-2xl space-y-1 shadow-lg shadow-emerald-950/10">
          <div className="text-[10px] uppercase font-bold text-emerald-300 tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Fees Collected</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono truncate">
            ${(summary.totalSwapFeesUsd || 0).toFixed(2)}
          </div>
          <div className="text-[11px] text-emerald-300/80 font-medium">PayFlux revenue</div>
        </div>
      </div>

      {/* Most-Used Swap Pairs Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span>Most-Used Swap Pairs</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Calculated dynamically from persistent on-chain transaction records
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {summary.mostUsedPairs.length} active trading pairs
          </span>
        </div>

        {summary.mostUsedPairs.length === 0 ? (
          <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800/80 text-slate-500 text-xs">
            No swap pairs executed yet. Pairs will populate automatically as users perform swaps.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {summary.mostUsedPairs.map((pairStat) => (
              <div
                key={`pair-${pairStat.pair}`}
                className="p-4 rounded-2xl bg-slate-950 border border-slate-800/90 space-y-2.5 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono font-black text-sm text-white">
                    <span className="text-cyan-300">{pairStat.fromTokenSymbol}</span>
                    <span className="text-slate-500">/</span>
                    <span className="text-purple-300">{pairStat.toTokenSymbol}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">
                    {pairStat.totalAttempts} {pairStat.totalAttempts === 1 ? 'trade' : 'trades'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Total Volume:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    ${pairStat.volumeUsd.toFixed(2)} USD
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Success Rate:</span>
                    <span className="font-mono text-cyan-300 font-bold">
                      {pairStat.successRate.toFixed(0)}% ({pairStat.successfulCount} / {pairStat.totalAttempts})
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, pairStat.successRate))}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Swap Transaction History Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-white">Persistent Swap Transaction History</h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                {filteredSwaps.length} of {summary.recentSwaps.length} Records
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Complete audit ledger of all user swap attempts, blockchain confirmations, rejections, and failure diagnostics
            </p>
          </div>

          {/* Status Filter Chips */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                statusFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({summary.totalAttempts})
            </button>
            <button
              onClick={() => setStatusFilter('success')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                statusFilter === 'success'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Successful ({summary.successfulSwaps})
            </button>
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                statusFilter === 'pending'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Pending ({summary.pendingSwaps || 0})
            </button>
            <button
              onClick={() => setStatusFilter('failed')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                statusFilter === 'failed'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Failed ({summary.recentSwaps.filter((r) => r.status === 'failed').length})
            </button>
            <button
              onClick={() => setStatusFilter('rejected')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                statusFilter === 'rejected'
                  ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Rejected ({summary.rejectedSwaps || 0})
            </button>
            <button
              onClick={() => setStatusFilter('cancelled')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                statusFilter === 'cancelled'
                  ? 'bg-slate-700/50 text-slate-300 border border-slate-600'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Cancelled ({summary.cancelledSwaps || 0})
            </button>
          </div>
        </div>

        {/* Search and Filters Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by wallet, token, pair, network, tx hash, or error..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Showing {filteredSwaps.length} transactions
          </span>
        </div>

        {/* Swap History Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                <th className="pb-3 pl-2">Date & Time</th>
                <th className="pb-3">User Wallet</th>
                <th className="pb-3">Swap Pair & Network</th>
                <th className="pb-3">Source Amount</th>
                <th className="pb-3">Destination Amount</th>
                <th className="pb-3">Amount (USD)</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">PayFlux Fee</th>
                <th className="pb-3 text-right pr-2">Tx Hash / Explorer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {filteredSwaps.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500 text-xs">
                    {searchQuery
                      ? 'No swap transactions match your search query.'
                      : 'No persistent swap activity recorded yet. Swaps initiated in PayFlux will populate here automatically.'}
                  </td>
                </tr>
              ) : (
                filteredSwaps.map((rec, idx) => (
                  <tr key={`swap-row-${rec.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                    {/* Timestamp */}
                    <td className="py-3.5 pl-2 text-slate-400 whitespace-nowrap">
                      <div>{new Date(rec.timestamp).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </td>

                    {/* User Wallet */}
                    <td className="py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-300">
                          {rec.userAddress && rec.userAddress !== '0x' ? shortenAddress(rec.userAddress, 4) : 'Anonymous'}
                        </span>
                        {rec.userAddress && rec.userAddress !== '0x' && (
                          <button
                            onClick={() => handleCopy(rec.userAddress, 'address')}
                            title="Copy user address"
                            className="text-slate-500 hover:text-white transition-colors"
                          >
                            {copiedAddress === rec.userAddress ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Pair & Network */}
                    <td className="py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white">{rec.fromTokenSymbol}</span>
                        <span className="text-slate-500">→</span>
                        <span className="font-bold text-cyan-300">{rec.toTokenSymbol}</span>
                        {rec.isCrossChain && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            Cross-Chain
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 capitalize">{rec.network || 'Polygon'}</div>
                    </td>

                    {/* Source Amount */}
                    <td className="py-3.5 font-mono text-white font-bold whitespace-nowrap">
                      {rec.fromAmount} {rec.fromTokenSymbol}
                    </td>

                    {/* Destination Amount */}
                    <td className="py-3.5 font-mono text-cyan-300 font-bold whitespace-nowrap">
                      {rec.toAmount} {rec.toTokenSymbol}
                    </td>

                    {/* USD Value */}
                    <td className="py-3.5 font-mono text-emerald-400 font-bold whitespace-nowrap">
                      ${(rec.fromAmountUsd || rec.toAmountUsd || 0).toFixed(2)}
                    </td>

                    {/* Status */}
                    <td className="py-3.5">
                      {rec.status === 'success' ? (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Successful</span>
                        </div>
                      ) : rec.status === 'pending' ? (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Pending</span>
                        </div>
                      ) : rec.status === 'rejected' ? (
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30">
                            <Ban className="w-3 h-3" />
                            <span>Rejected in Wallet</span>
                          </div>
                          {rec.failureReason && rec.failureReason !== 'Transaction rejected in your wallet.' && (
                            <div className="text-[10px] text-orange-400/80 max-w-[200px] truncate" title={rec.failureReason}>
                              {rec.failureReason}
                            </div>
                          )}
                        </div>
                      ) : rec.status === 'cancelled' ? (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                          <Slash className="w-3 h-3" />
                          <span>Cancelled by User</span>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            <XCircle className="w-3 h-3" />
                            <span>Failed</span>
                          </div>
                          {rec.failureReason && (
                            <div className="text-[10px] text-rose-400/80 max-w-[200px] truncate" title={rec.failureReason}>
                              {rec.failureReason}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* PayFlux Fee */}
                    <td className="py-3.5 whitespace-nowrap">
                      {rec.feeStatus === 'confirmed' && rec.feeTxHash ? (
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-emerald-400 font-bold text-xs">
                            ${(rec.payfluxFeeUsd ?? 0.10).toFixed(2)}
                          </span>
                          <a
                            href={getExplorerTxUrl(rec.network, rec.feeTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-cyan-400 hover:underline flex items-center gap-0.5"
                            title="View verified on-chain fee transfer to PayFlux revenue wallet"
                          >
                            <span>(Verified)</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      ) : rec.status === 'success' && rec.feeStatus !== 'confirmed' ? (
                        <span className="text-[10px] text-slate-500 font-mono">Uncollected ($0.00)</span>
                      ) : (
                        <span className="text-[10px] text-slate-600 font-mono">—</span>
                      )}
                    </td>

                    {/* Hash & Explorer */}
                    <td className="py-3.5 text-right pr-2 font-mono whitespace-nowrap">
                      {rec.txHash ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <a
                            href={rec.explorerUrl || getExplorerTxUrl(rec.network, rec.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:underline inline-flex items-center gap-1 font-bold"
                          >
                            <span>{shortenAddress(rec.txHash, 4)}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <button
                            onClick={() => handleCopy(rec.txHash!, 'hash')}
                            title="Copy transaction hash"
                            className="text-slate-500 hover:text-white transition-colors"
                          >
                            {copiedHash === rec.txHash ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 italic">
                          {rec.status === 'failed' || rec.status === 'rejected' || rec.status === 'cancelled' ? 'Pre-broadcast' : 'Broadcasting...'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
