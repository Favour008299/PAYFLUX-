import React, { useState, useMemo } from 'react';
import {
  Clock,
  ArrowLeftRight,
  Send,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  Search,
  ExternalLink,
  Download,
  Filter,
  ArrowUpRight,
  Copy,
  Check
} from 'lucide-react';
import { TransactionRecord, TxStatus, UserSettings } from '../types';
import { formatCurrency, shortenAddress, timeAgo } from '../utils/crypto';

interface HistoryViewProps {
  transactions: TransactionRecord[];
  settings: UserSettings;
  onOpenExplorer: (tx: TransactionRecord) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  transactions,
  settings,
  onOpenExplorer,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'swap' | 'send' | 'receive'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const filteredTxList = useMemo(() => {
    return transactions.filter((tx) => {
      // Status filter
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;

      // Type filter
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesHash = tx.hash.toLowerCase().includes(q);
        const matchesFrom = tx.fromTokenSymbol && tx.fromTokenSymbol.toLowerCase().includes(q);
        const matchesTo = tx.toTokenSymbol && tx.toTokenSymbol.toLowerCase().includes(q);
        const matchesToken = tx.tokenSymbol && tx.tokenSymbol.toLowerCase().includes(q);
        if (!matchesHash && !matchesFrom && !matchesTo && !matchesToken) return false;
      }

      return true;
    });
  }, [transactions, statusFilter, typeFilter, searchQuery]);

  const handleCopyHash = (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleExportCsv = () => {
    const headers = 'ID,Hash,Type,FromToken,ToToken,FromAmount,ToAmount,NetworkFeeUSD,Status,Timestamp\n';
    const rows = filteredTxList.map((t) =>
      `${t.id},${t.hash},${t.type},${t.fromTokenSymbol || ''},${t.toTokenSymbol || t.tokenSymbol || ''},${t.fromAmount || ''},${t.toAmount || t.amount || ''},${t.networkFeeUsd},${t.status},${new Date(t.timestamp).toISOString()}`
    ).join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `verseswap-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-5 pb-12 text-slate-100">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <Clock className="w-6 h-6 text-cyan-400" />
            <span>Transaction History</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time record of all your swaps, transfers, and receipts.
          </p>
        </div>

        <button
          id="export-csv-btn"
          onClick={handleExportCsv}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-200 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-cyan-400" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="tx-search-input"
            type="text"
            placeholder="Search by token (VERSE, BCH, USDT) or Tx Hash..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Status Filter Buttons */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {(['all', 'completed', 'pending', 'failed'] as const).map((st) => (
            <button
              key={st}
              id={`filter-status-${st}`}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl divide-y divide-slate-800/80">
        {filteredTxList.length === 0 ? (
          <div className="p-12 text-center">
            <Clock className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-white mb-1">No transactions found</h4>
            <p className="text-xs text-slate-400">
              Transactions will appear here automatically when you swap or transfer.
            </p>
          </div>
        ) : (
          filteredTxList.map((tx, idx) => (
            <div
              key={`${tx.id}-${idx}`}
              id={`history-row-${tx.id}`}
              onClick={() => onOpenExplorer(tx)}
              className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/50 cursor-pointer transition-colors"
            >
              {/* Left Column: Type & Status */}
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold flex-shrink-0 ${
                    tx.type === 'swap'
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                      : tx.type === 'send'
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  }`}
                >
                  {tx.type === 'swap' ? (
                    <ArrowLeftRight className="w-5 h-5" />
                  ) : tx.type === 'send' ? (
                    <Send className="w-5 h-5" />
                  ) : (
                    <QrCode className="w-5 h-5" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-white capitalize">
                      {tx.type === 'swap'
                        ? `Swap ${tx.fromTokenSymbol} → ${tx.toTokenSymbol}`
                        : `${tx.type} ${tx.tokenSymbol}`}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                        tx.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : tx.status === 'pending'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {tx.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                    <span>{new Date(tx.timestamp).toLocaleString()}</span>
                    <span>•</span>
                    <span>Fee: {formatCurrency(tx.networkFeeUsd, settings.currency)}</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Amount & Hash Details */}
              <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 text-right">
                <div className="text-sm font-black font-mono text-white">
                  {tx.type === 'swap' ? (
                    <span className="text-cyan-300">
                      +{tx.toAmount} {tx.toTokenSymbol}
                    </span>
                  ) : (
                    <span>
                      {tx.amount} {tx.tokenSymbol}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                  <span>{shortenAddress(tx.hash, 4)}</span>
                  <button
                    onClick={(e) => handleCopyHash(tx.hash, e)}
                    className="p-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                    title="Copy Hash"
                  >
                    {copiedHash === tx.hash ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  <ExternalLink className="w-3 h-3 text-cyan-400" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
