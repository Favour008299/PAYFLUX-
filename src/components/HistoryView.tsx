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
  Check,
  Trash2,
  DollarSign,
  Store,
  RefreshCw,
  Info
} from 'lucide-react';
import { TransactionRecord, TxStatus, UserSettings } from '../types';
import { formatCurrency, shortenAddress, timeAgo } from '../utils/crypto';

interface HistoryViewProps {
  transactions: TransactionRecord[];
  settings: UserSettings;
  onOpenExplorer: (tx: TransactionRecord) => void;
  onDeleteTransaction?: (id: string, hash?: string) => void;
  onClearHistory?: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  transactions,
  settings,
  onOpenExplorer,
  onDeleteTransaction,
  onClearHistory,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'swap' | 'payment' | 'send' | 'receive'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredTxList = useMemo(() => {
    return transactions.filter((tx) => {
      // Status filter
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;

      // Type filter
      if (typeFilter !== 'all') {
        if (typeFilter === 'payment' && tx.type !== 'payment') return false;
        if (typeFilter === 'swap' && tx.type !== 'swap') return false;
        if (typeFilter === 'send' && tx.type !== 'send') return false;
        if (typeFilter === 'receive' && tx.type !== 'receive') return false;
      }

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesHash = tx.hash && tx.hash.toLowerCase().includes(q);
        const matchesFrom = tx.fromTokenSymbol && tx.fromTokenSymbol.toLowerCase().includes(q);
        const matchesTo = tx.toTokenSymbol && tx.toTokenSymbol.toLowerCase().includes(q);
        const matchesToken = tx.tokenSymbol && tx.tokenSymbol.toLowerCase().includes(q);
        const matchesMerchant = tx.merchantName && tx.merchantName.toLowerCase().includes(q);
        const matchesProduct = tx.productName && tx.productName.toLowerCase().includes(q);
        if (!matchesHash && !matchesFrom && !matchesTo && !matchesToken && !matchesMerchant && !matchesProduct) {
          return false;
        }
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

  const handleDelete = (tx: TransactionRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDeleteTransaction) {
      setDeletingId(tx.id);
      setTimeout(() => {
        onDeleteTransaction(tx.id, tx.hash);
        setDeletingId(null);
      }, 150);
    }
  };

  const handleExportCsv = () => {
    const headers = 'ID,Hash,Type,FromToken,ToToken,FromAmount,ToAmount,Token,Amount,NetworkFeeUSD,PayFluxFeeUSD,Status,Timestamp\n';
    const rows = filteredTxList.map((t) =>
      `${t.id},${t.hash},${t.type},${t.fromTokenSymbol || ''},${t.toTokenSymbol || ''},${t.fromAmount || ''},${t.toAmount || ''},${t.tokenSymbol || ''},${t.amount || ''},${t.networkFeeUsd},${t.payfluxFeeUsd || 0.10},${t.status},${new Date(t.timestamp).toISOString()}`
    ).join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payflux-verseswap-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-5 pb-12 text-slate-100">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Clock className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-black text-white">Transaction History</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Permanent ledger of all your swaps, customer checkouts, merchant payments, and transfers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {filteredTxList.length > 0 && onClearHistory && (
            <>
              {showClearConfirm ? (
                <div className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-500/40 p-1 rounded-xl animate-fadeIn">
                  <span className="text-[10px] text-rose-300 font-bold px-2">Clear all records?</span>
                  <button
                    id="confirm-clear-history-btn"
                    onClick={() => {
                      onClearHistory();
                      setShowClearConfirm(false);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black transition-colors"
                  >
                    Yes, Clear
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  id="clear-history-btn"
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-950 hover:bg-rose-950/40 hover:border-rose-500/40 border border-slate-800 text-xs font-bold text-slate-300 hover:text-rose-300 transition-colors"
                  title="Clear all transactions"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Clear History</span>
                </button>
              )}
            </>
          )}

          <button
            id="export-csv-btn"
            onClick={handleExportCsv}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-200 transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-3 bg-slate-900/70 p-3.5 rounded-2xl border border-slate-800">
        {/* Search */}
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="tx-search-input"
            type="text"
            placeholder="Search by token (VERSE, POL, USDT), merchant, product or tx hash..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
          {/* Type Filters */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] uppercase font-bold text-slate-500 mr-1">Type:</span>
            {(['all', 'swap', 'payment', 'send', 'receive'] as const).map((tp) => (
              <button
                key={tp}
                id={`filter-type-${tp}`}
                onClick={() => setTypeFilter(tp)}
                className={`px-3 py-1 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${
                  typeFilter === tp
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-sm'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {tp === 'payment' ? 'Payments' : tp}
              </button>
            ))}
          </div>

          {/* Status Filters */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] uppercase font-bold text-slate-500 mr-1">Status:</span>
            {(['all', 'completed', 'pending', 'failed'] as const).map((st) => (
              <button
                key={st}
                id={`filter-status-${st}`}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-slate-100 text-slate-950 font-black'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl divide-y divide-slate-800/80">
        {filteredTxList.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Clock className="w-10 h-10 text-slate-600 mx-auto" />
            <h4 className="text-sm font-bold text-white">No transactions found</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Anytime a swap or payment is executed, it will permanently appear in this history tab unless deleted.
            </p>
          </div>
        ) : (
          filteredTxList.map((tx, idx) => {
            const isDeleting = deletingId === tx.id;
            return (
              <div
                key={`${tx.id}-${idx}`}
                id={`history-row-${tx.id}`}
                onClick={() => onOpenExplorer(tx)}
                className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/50 cursor-pointer transition-all ${
                  isDeleting ? 'opacity-30 scale-95' : 'opacity-100'
                }`}
              >
                {/* Left Column: Type & Status */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold flex-shrink-0 ${
                      tx.type === 'swap'
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        : tx.type === 'payment'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : tx.type === 'send'
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    }`}
                  >
                    {tx.type === 'swap' ? (
                      <ArrowLeftRight className="w-5 h-5" />
                    ) : tx.type === 'payment' ? (
                      <Store className="w-5 h-5" />
                    ) : tx.type === 'send' ? (
                      <Send className="w-5 h-5" />
                    ) : (
                      <QrCode className="w-5 h-5" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-sm text-white capitalize truncate">
                        {tx.type === 'swap'
                          ? `Swap ${tx.fromTokenSymbol} → ${tx.toTokenSymbol}`
                          : tx.type === 'payment'
                          ? `Payment: ${tx.productName || tx.merchantName || 'Merchant Checkout'}`
                          : `${tx.type} ${tx.tokenSymbol}`}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${
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

                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1 flex-wrap">
                      <span>{new Date(tx.timestamp).toLocaleString()}</span>
                      <span>•</span>
                      <span className="text-cyan-400 font-mono font-semibold">
                        Platform Fee: {tx.payfluxFeeDisplay || (tx.payfluxFeePol ? `${tx.payfluxFeePol} POL` : '0.1 POL')}
                      </span>
                      {tx.merchantName && (
                        <>
                          <span>•</span>
                          <span className="text-slate-300 truncate">Merchant: {tx.merchantName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Amount & Actions */}
                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 text-right shrink-0">
                  <div className="text-sm font-black font-mono text-white">
                    {tx.type === 'swap' ? (
                      <span className="text-cyan-300">
                        +{tx.toAmount} {tx.toTokenSymbol}
                      </span>
                    ) : (
                      <span className="text-emerald-400">
                        {tx.amount || tx.fromAmount} {tx.tokenSymbol || tx.fromTokenSymbol}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenExplorer(tx);
                      }}
                      className="p-1 rounded bg-slate-950 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 transition-colors"
                      title="View on Explorer"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>

                    {/* Delete Individual Transaction Button */}
                    {onDeleteTransaction && (
                      <button
                        id={`delete-tx-${tx.id}`}
                        onClick={(e) => handleDelete(tx, e)}
                        className="p-1 rounded bg-slate-950 hover:bg-rose-950 text-slate-400 hover:text-rose-400 transition-colors"
                        title="Delete from History"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
