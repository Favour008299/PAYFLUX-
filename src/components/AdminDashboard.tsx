import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  ExternalLink,
  Users,
  Receipt,
  TrendingUp,
  Activity,
  DollarSign,
  Layers,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowUpRight,
  Copy,
  Check,
  Wallet,
  Coins,
  ArrowRightLeft,
  XCircle
} from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { AdminLoginCard } from './AdminLoginCard';
import { AdminManagementPanel } from './AdminManagementPanel';
import { AdminSwapAnalyticsView } from './AdminSwapAnalyticsView';
import { PlatformAnalytics, CustomerPaymentReceipt, MerchantInvoice, SwapAnalyticsSummary, NetworkType } from '../types';
import {
  getPlatformAnalytics,
  getCustomerReceipts,
  getMerchantInvoices,
  subscribeToPaymentUpdates
} from '../services/paymentStorage';
import {
  getSwapAnalyticsSummary,
  subscribeToSwapAnalytics,
  syncSwapsFromFirestore
} from '../services/swapAnalyticsService';
import {
  PAYFLUX_PLATFORM_FEE_POL,
  PAYFLUX_PLATFORM_FEE_DISPLAY,
  PAYFLUX_TREASURY_ADDRESS
} from '../config/platform';
import { shortenAddress } from '../utils/crypto';
import { getExplorerTxUrl } from '../services/contractConfig';
import { PRIMARY_ADMIN_EMAIL } from '../services/adminAuthService';

interface AdminDashboardProps {
  onBackToApp?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBackToApp }) => {
  const { user, adminRecord, isAdmin, isSuperAdmin, loading, error, logout, refreshAdminStatus } = useAdminAuth();
  
  const [activeSubTab, setActiveSubTab] = useState<'analytics' | 'revenue_history' | 'swap_analytics' | 'invoices' | 'receipts' | 'admins'>('analytics');
  const [platformAnalytics, setPlatformAnalytics] = useState<PlatformAnalytics>(getPlatformAnalytics());
  const [swapSummary, setSwapSummary] = useState<SwapAnalyticsSummary>(getSwapAnalyticsSummary());
  const [allInvoices, setAllInvoices] = useState<MerchantInvoice[]>([]);
  const [allReceipts, setAllReceipts] = useState<CustomerPaymentReceipt[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedWallet, setCopiedWallet] = useState(false);

  const handleCopyWallet = () => {
    navigator.clipboard.writeText(PAYFLUX_TREASURY_ADDRESS);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  const loadData = () => {
    setPlatformAnalytics(getPlatformAnalytics());
    setSwapSummary(getSwapAnalyticsSummary());
    setAllInvoices(getMerchantInvoices());
    setAllReceipts(getCustomerReceipts());
  };

  useEffect(() => {
    if (isAdmin) {
      loadData();
      const unsubPayments = subscribeToPaymentUpdates(() => {
        loadData();
      });
      const unsubSwaps = subscribeToSwapAnalytics(() => {
        loadData();
      });

      // Synchronize latest swaps from Firestore
      syncSwapsFromFirestore().then(() => {
        loadData();
      });

      const interval = setInterval(() => {
        syncSwapsFromFirestore().then(() => {
          loadData();
        });
      }, 6000);

      return () => {
        unsubPayments();
        unsubSwaps();
        clearInterval(interval);
      };
    }
  }, [isAdmin]);

  // If still checking authentication state from Firebase
  if (loading) {
    return (
      <div className="w-full max-w-4xl mx-auto min-h-[60vh] flex flex-col items-center justify-center space-y-4 text-center p-8">
        <div className="p-4 rounded-3xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
          <RefreshCw className="w-8 h-8 animate-spin" />
        </div>
        <div>
          <h2 className="text-lg font-black text-white">Verifying PayFlux Admin Authentication</h2>
          <p className="text-xs text-slate-400 mt-1 font-mono">Securing admin session credentials...</p>
        </div>
      </div>
    );
  }

  // If not authenticated or not an authorized admin -> Show login card with lock screen
  if (!user || !isAdmin) {
    return (
      <div className="w-full max-w-5xl mx-auto py-8 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={onBackToApp}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-bold"
          >
            ← Return to PayFlux App
          </button>
          <span className="text-[11px] text-slate-500 font-mono">PayFlux Security Subsystem v2.5</span>
        </div>

        <AdminLoginCard />

        {user && !isAdmin && (
          <div className="max-w-md mx-auto p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-rose-400 font-bold text-xs">
              <ShieldAlert className="w-4 h-4" />
              <span>Unauthorized Account</span>
            </div>
            <p className="text-xs text-slate-300">
              Logged in as <strong className="text-white font-mono">{user.email}</strong>. This account does not possess PayFlux Owner or Administrator permissions.
            </p>
            <p className="text-[11px] text-slate-400">
              Only authorized personnel (such as <strong className="text-cyan-300">{PRIMARY_ADMIN_EMAIL}</strong>) may access this area.
            </p>
            <button
              onClick={logout}
              className="mt-2 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold transition-colors"
            >
              Sign Out and Try Another Account
            </button>
          </div>
        )}
      </div>
    );
  }

  // Filtered queries for data tables
  const filteredInvoices = allInvoices.filter((inv) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      inv.merchantName.toLowerCase().includes(q) ||
      inv.productName.toLowerCase().includes(q) ||
      inv.id.toLowerCase().includes(q) ||
      inv.merchantAddress.toLowerCase().includes(q)
    );
  });

  const filteredReceipts = allReceipts.filter((rcpt) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      rcpt.merchantName.toLowerCase().includes(q) ||
      rcpt.productName.toLowerCase().includes(q) ||
      rcpt.txHash.toLowerCase().includes(q) ||
      rcpt.tokenSymbol.toLowerCase().includes(q)
    );
  });

  const [feeStatusFilter, setFeeStatusFilter] = useState<'all' | 'confirmed' | 'pending' | 'failed'>('all');

  // Comprehensive Real-Time Fee Tracking Ledger (Confirmed, Pending, and Failed fees)
  // Strictly counts fees as revenue ONLY when blockchain confirms the transfer to PayFlux revenue wallet
  const feeAuditRecords = useMemo(() => {
    const list: Array<{
      id: string;
      source: 'swap' | 'checkout';
      timestamp: number;
      payerWallet: string;
      feeAmountDisplay: string;
      feeAmountPol: number;
      token: string;
      network: string;
      feeStatus: 'confirmed' | 'pending' | 'failed';
      feeTxHash?: string;
      txHash: string;
      explorerUrl: string;
      feeExplorerUrl?: string;
      revenueWallet: string;
      description: string;
      subDescription?: string;
    }> = [];

    // 1. Merchant Checkout Fees
    allReceipts.forEach((rcpt) => {
      const isConfirmed = rcpt.status === 'completed' && rcpt.feeStatus === 'confirmed' && Boolean(rcpt.feeTxHash);
      const isPending = rcpt.status === 'pending' || rcpt.feeStatus === 'pending';
      const determinedStatus: 'confirmed' | 'pending' | 'failed' = isConfirmed ? 'confirmed' : isPending ? 'pending' : 'failed';
      const feeTxHash = rcpt.feeTxHash;

      list.push({
        id: `fee-rcpt-${rcpt.id}`,
        source: 'checkout',
        timestamp: rcpt.timestamp,
        payerWallet: rcpt.payerAddress,
        feeAmountDisplay: isConfirmed ? PAYFLUX_PLATFORM_FEE_DISPLAY : isPending ? `${PAYFLUX_PLATFORM_FEE_DISPLAY} (Pending)` : '0.0 POL',
        feeAmountPol: isConfirmed ? (rcpt.payfluxFeePol || PAYFLUX_PLATFORM_FEE_POL) : 0,
        token: 'POL',
        network: 'Polygon',
        feeStatus: determinedStatus,
        feeTxHash,
        txHash: rcpt.txHash,
        explorerUrl: rcpt.explorerUrl || (rcpt.txHash ? getExplorerTxUrl(rcpt.network, rcpt.txHash) : ''),
        feeExplorerUrl: feeTxHash ? `https://polygonscan.com/tx/${feeTxHash}` : undefined,
        revenueWallet: PAYFLUX_TREASURY_ADDRESS,
        description: rcpt.merchantName,
        subDescription: rcpt.productName,
      });
    });

    // 2. DEX Swap Platform Fees (Real On-Chain Verified to PayFlux Revenue Wallet)
    swapSummary.recentSwaps.forEach((swap) => {
      const isConfirmed = (swap.status === 'confirmed' || swap.status === 'success') && swap.feeStatus === 'confirmed' && Boolean(swap.feeTxHash);
      const isPending = swap.feeStatus === 'pending' || swap.status === 'pending' || swap.status === 'attempted';
      const determinedStatus: 'confirmed' | 'pending' | 'failed' = isConfirmed ? 'confirmed' : isPending ? 'pending' : 'failed';
      const feeTxHash = swap.feeTxHash;

      list.push({
        id: `fee-swap-${swap.id}`,
        source: 'swap',
        timestamp: swap.timestamp,
        payerWallet: swap.userAddress,
        feeAmountDisplay: isConfirmed ? PAYFLUX_PLATFORM_FEE_DISPLAY : isPending ? `${PAYFLUX_PLATFORM_FEE_DISPLAY} (Pending)` : '0.0 POL',
        feeAmountPol: isConfirmed ? (swap.payfluxFeePol || PAYFLUX_PLATFORM_FEE_POL) : 0,
        token: 'POL',
        network: 'Polygon',
        feeStatus: determinedStatus,
        feeTxHash,
        txHash: swap.txHash || '',
        explorerUrl: swap.explorerUrl || (swap.txHash ? getExplorerTxUrl(swap.network, swap.txHash) : ''),
        feeExplorerUrl: feeTxHash ? `https://polygonscan.com/tx/${feeTxHash}` : undefined,
        revenueWallet: swap.feeRecipient || PAYFLUX_TREASURY_ADDRESS,
        description: `Swap: ${swap.pair || `${swap.fromTokenSymbol}/${swap.toTokenSymbol}`}`,
        subDescription: swap.isCrossChain ? 'deBridge Cross-Chain' : 'Polygon DEX Router',
      });
    });

    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [allReceipts, swapSummary.recentSwaps]);

  const confirmedFeesList = useMemo(() => feeAuditRecords.filter((r) => r.feeStatus === 'confirmed'), [feeAuditRecords]);
  const pendingFeesList = useMemo(() => feeAuditRecords.filter((r) => r.feeStatus === 'pending'), [feeAuditRecords]);
  const failedFeesList = useMemo(() => feeAuditRecords.filter((r) => r.feeStatus === 'failed'), [feeAuditRecords]);

  const totalConfirmedFeesPol = useMemo(() => {
    return confirmedFeesList.reduce((acc, r) => acc + r.feeAmountPol, 0);
  }, [confirmedFeesList]);

  const filteredRevenueRecords = useMemo(() => {
    let result = feeAuditRecords;
    if (feeStatusFilter !== 'all') {
      result = result.filter((r) => r.feeStatus === feeStatusFilter);
    }
    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase();
    return result.filter(
      (rec) =>
        rec.token.toLowerCase().includes(q) ||
        rec.network.toLowerCase().includes(q) ||
        rec.payerWallet.toLowerCase().includes(q) ||
        rec.txHash.toLowerCase().includes(q) ||
        (rec.feeTxHash && rec.feeTxHash.toLowerCase().includes(q)) ||
        rec.description.toLowerCase().includes(q) ||
        (rec.subDescription && rec.subDescription.toLowerCase().includes(q)) ||
        rec.source.toLowerCase().includes(q) ||
        rec.feeStatus.toLowerCase().includes(q)
    );
  }, [feeAuditRecords, feeStatusFilter, searchQuery]);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8 pb-12 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 backdrop-blur-xl border border-purple-500/30 p-6 rounded-3xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-purple-500/10 via-cyan-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-4 relative">
          <div className="p-3.5 rounded-2xl bg-gradient-to-tr from-purple-600 to-cyan-500 text-slate-950 font-bold shadow-lg shadow-purple-500/30">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white">PayFlux Administrative Hub</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Authenticated
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Logged in as <strong className="text-cyan-300">{user.email}</strong> ({adminRecord?.role || 'Admin'})
            </p>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2 self-start md:self-auto relative">
          <button
            onClick={refreshAdminStatus}
            title="Refresh state"
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out Admin</span>
          </button>
        </div>
      </div>

      {/* Admin Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-2 rounded-2xl border border-slate-800">
        <button
          onClick={() => setActiveSubTab('analytics')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSubTab === 'analytics'
              ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-slate-950 shadow-md shadow-purple-950/50'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Platform Revenue & Overview</span>
        </button>

        <button
          onClick={() => setActiveSubTab('revenue_history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSubTab === 'revenue_history'
              ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          <span>Revenue & Fee History (${platformAnalytics.totalPayfluxRevenueUsd.toFixed(2)})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('swap_analytics')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSubTab === 'swap_analytics'
              ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-slate-950 shadow-md shadow-cyan-950/50'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>Swap Analytics ({swapSummary.totalAttempts})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('invoices')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSubTab === 'invoices'
              ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>All Merchant Invoices ({allInvoices.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('receipts')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSubTab === 'receipts'
              ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>All Customer Checkouts ({allReceipts.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('admins')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeSubTab === 'admins'
              ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Admin Access Management</span>
        </button>
      </div>

      {/* SUB-VIEW 1: REVENUE & OVERVIEW */}
      {activeSubTab === 'analytics' && (
        <div className="space-y-6">
          {/* Live Web & Conversion Analytics Banner */}
          <a
            id="admin-open-vgdh-analytics-banner"
            href="https://analytics.vgdh.io/payflux-orcin.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-3xl bg-gradient-to-r from-emerald-950/50 via-slate-900 to-slate-950 border border-emerald-500/40 hover:border-emerald-400 transition-all text-white group shadow-xl shadow-emerald-950/20"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 group-hover:scale-105 transition-transform">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-sm flex items-center gap-2 flex-wrap">
                  <span>PayFlux Real-Time Traffic & Event Analytics</span>
                  <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live on analytics.vgdh.io
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  View real-time visitors, virtual pageviews (/swap, /pay, /merchant, /portfolio), and conversion telemetry.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shrink-0 transition-all shadow-md shadow-emerald-500/20">
              <span>Open Live Analytics</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </div>
          </a>

          {/* Revenue KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-slate-900 border border-purple-500/40 p-5 rounded-3xl space-y-1 shadow-lg shadow-purple-950/20">
              <div className="text-[10px] uppercase font-bold text-purple-300 tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>PayFlux Fee Revenue</span>
              </div>
              <div className="text-3xl font-black text-purple-300 font-mono">
                {totalConfirmedFeesPol.toFixed(1)} POL
              </div>
              <div className="text-[11px] text-slate-400">Fixed 0.1 POL fee per transaction</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
                <span>Gross Checkout Volume</span>
              </div>
              <div className="text-3xl font-black text-white font-mono">
                ${platformAnalytics.totalVolumeUsd.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400">Across all merchant transactions</div>
            </div>

            <div className="bg-slate-900 border border-cyan-500/30 p-5 rounded-3xl space-y-1 shadow-lg shadow-cyan-950/20">
              <div className="text-[10px] uppercase font-bold text-cyan-300 tracking-wider flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                <span>DEX Swaps Telemetry</span>
              </div>
              <div className="text-3xl font-black text-cyan-300 font-mono">
                {swapSummary.successfulSwaps} <span className="text-xs text-slate-400 font-normal">/ {swapSummary.totalAttempts}</span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                ${swapSummary.totalSwapVolumeUsd.toFixed(2)} USD • {swapSummary.uniqueUsersCount} Swappers
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Fee Collection Breakdown</span>
              </div>
              <div className="text-2xl font-black text-emerald-400 font-mono">
                {confirmedFeesList.length} Confirmed
              </div>
              <div className="text-[11px] text-slate-400 font-medium">
                {pendingFeesList.length} Pending • {failedFeesList.length} Failed
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                <span>Platform Users</span>
              </div>
              <div className="text-3xl font-black text-white font-mono">
                {platformAnalytics.totalMerchantsCount} Merchants
              </div>
              <div className="text-[11px] text-slate-400">
                {platformAnalytics.totalCustomersCount} Active Customers
              </div>
            </div>
          </div>

          {/* Dedicated PayFlux Platform Revenue Wallet Panel */}
          <div className="bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-purple-500/40 rounded-3xl p-6 sm:p-7 space-y-5 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative">
              <div className="flex items-center gap-3.5">
                <div className="p-3 rounded-2xl bg-purple-500/20 border border-purple-500/30 text-purple-300 shadow-md">
                  <Wallet className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-white">Fixed Polygon Revenue Wallet</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      Polygon PoS
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Designated destination for all fixed 0.1 POL PayFlux platform fees across swaps and checkouts
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyWallet}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700"
                >
                  {copiedWallet ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Address</span>
                    </>
                  )}
                </button>
                <a
                  href={`https://polygonscan.com/address/${PAYFLUX_TREASURY_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-bold transition-all"
                >
                  <span>Polygonscan</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Address Display Box */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <span className="text-slate-400 font-medium">Public Receiving Address:</span>
                <span className="font-mono text-cyan-300 font-bold break-all selection:bg-cyan-500 selection:text-slate-950">
                  {PAYFLUX_TREASURY_ADDRESS}
                </span>
              </div>
            </div>

            {/* Revenue Metrics and Security Assurances */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400">Platform Rate</div>
                <div className="text-sm font-black text-white font-mono">0.1 POL / transaction</div>
                <p className="text-[10px] text-slate-500">Auto-allocated on-chain to revenue wallet</p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400">Total Accrued Fees</div>
                <div className="text-sm font-black text-purple-300 font-mono">
                  {totalConfirmedFeesPol.toFixed(1)} POL
                </div>
                <p className="text-[10px] text-emerald-400 font-medium">
                  {confirmedFeesList.length} confirmed fee transactions
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-950/20 border border-emerald-500/20 space-y-1">
                <div className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Security Guarantee</span>
                </div>
                <div className="text-xs font-bold text-emerald-300">Public Receiving Only</div>
                <p className="text-[10px] text-slate-400">Private keys/seed phrases remain strictly off-client</p>
              </div>
            </div>
          </div>

          {/* Quick Transaction Feed Preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Recent Confirmed Revenue Settlements</h3>
                <p className="text-xs text-slate-400">
                  Confirmed fees received in PayFlux revenue wallet <strong className="text-purple-300 font-mono">{shortenAddress(PAYFLUX_TREASURY_ADDRESS, 5)}</strong>
                </p>
              </div>
              <button
                onClick={() => setActiveSubTab('revenue_history')}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"
              >
                <span>View Full Fee Ledger ({feeAuditRecords.length})</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {confirmedFeesList.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800/80 text-slate-500 text-xs">
                No confirmed fees received yet. Revenue is strictly recorded once blockchain confirms the 0.1 POL fee receipt.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                      <th className="pb-3 pl-2">Date & Time</th>
                      <th className="pb-3">Source</th>
                      <th className="pb-3">Payer / Swapper</th>
                      <th className="pb-3">Token</th>
                      <th className="pb-3">Network</th>
                      <th className="pb-3">Fee Amount</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3 text-right pr-2">Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {confirmedFeesList.slice(0, 5).map((rev, idx) => (
                      <tr key={`recent-fee-${rev.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 pl-2 text-slate-400">
                          <div>{new Date(rev.timestamp).toLocaleDateString()}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {new Date(rev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              rev.source === 'swap'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            }`}
                          >
                            {rev.source === 'swap' ? 'DEX Swap' : 'Checkout'}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-slate-300">
                          {shortenAddress(rev.payerWallet, 4)}
                        </td>
                        <td className="py-3 font-mono font-bold text-white">
                          <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-200 border border-slate-700/60 text-[11px]">
                            {rev.token}
                          </span>
                        </td>
                        <td className="py-3 uppercase text-[11px] font-semibold text-slate-400">
                          {rev.network}
                        </td>
                        <td className="py-3 font-mono text-purple-300 font-bold">
                          +{rev.feeAmountDisplay}
                        </td>
                        <td className="py-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Confirmed</span>
                          </span>
                        </td>
                        <td className="py-3 text-right pr-2 font-mono">
                          <a
                            href={rev.feeExplorerUrl || rev.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:underline inline-flex items-center gap-1 font-bold"
                          >
                            <span>{shortenAddress(rev.feeTxHash || rev.txHash, 4)}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Swap Analytics Jump Card */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-cyan-500/30 rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300">
                <ArrowRightLeft className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>DEX Swap Analytics & On-Chain Confirmation Ledger</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    Live
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Audit swap attempts, on-chain confirmations, volume, most-used trading pairs, and fee receipts in real-time.
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveSubTab('swap_analytics')}
              className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 text-xs font-black shadow-lg shadow-cyan-950/40 transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <span>Open Swap Analytics</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: DEDICATED REVENUE & FEE HISTORY */}
      {activeSubTab === 'revenue_history' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white">Platform Revenue & Fee Ledger</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {totalConfirmedFeesPol.toFixed(1)} POL Confirmed Revenue
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Real on-chain platform fees received in revenue wallet{' '}
                <strong className="text-cyan-300 font-mono">{PAYFLUX_TREASURY_ADDRESS}</strong>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyWallet}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700"
              >
                {copiedWallet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy Wallet</span>
              </button>
              <a
                href={`https://polygonscan.com/address/${PAYFLUX_TREASURY_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-slate-950 font-bold text-xs transition-colors shadow-md shadow-purple-950/40"
              >
                <span>Polygonscan Ledger</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Status Filter Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFeeStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                feeStatusFilter === 'all'
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All Fees ({feeAuditRecords.length})
            </button>
            <button
              onClick={() => setFeeStatusFilter('confirmed')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                feeStatusFilter === 'confirmed'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-emerald-300'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Confirmed ({confirmedFeesList.length})</span>
            </button>
            <button
              onClick={() => setFeeStatusFilter('pending')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                feeStatusFilter === 'pending'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-amber-300'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Pending ({pendingFeesList.length})</span>
            </button>
            <button
              onClick={() => setFeeStatusFilter('failed')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                feeStatusFilter === 'failed'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'text-slate-400 hover:text-rose-300'
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Failed / Uncollected ({failedFeesList.length})</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by token, network, hash, swapper or merchant..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Showing {filteredRevenueRecords.length} of {feeAuditRecords.length} fee records
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="pb-3 pl-2">Date & Time</th>
                  <th className="pb-3">Source</th>
                  <th className="pb-3">Payer / Swapper</th>
                  <th className="pb-3">Description</th>
                  <th className="pb-3">Fee Amount</th>
                  <th className="pb-3">Token</th>
                  <th className="pb-3">Network</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3 text-right pr-2">Transaction Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredRevenueRecords.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500 text-xs">
                      {searchQuery
                        ? 'No fee transactions match your filter query.'
                        : 'No fee records found in this category.'}
                    </td>
                  </tr>
                ) : (
                  filteredRevenueRecords.map((rev, idx) => (
                    <tr key={`rev-fee-row-${rev.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                      {/* Date & Time */}
                      <td className="py-3.5 pl-2 text-slate-400 whitespace-nowrap">
                        <div>{new Date(rev.timestamp).toLocaleDateString()}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {new Date(rev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </td>

                      {/* Source */}
                      <td className="py-3.5 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            rev.source === 'swap'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                              : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          }`}
                        >
                          {rev.source === 'swap' ? 'DEX Swap' : 'Merchant Checkout'}
                        </span>
                      </td>

                      {/* Payer / Swapper Wallet */}
                      <td className="py-3.5 font-mono text-slate-300 whitespace-nowrap">
                        {rev.payerWallet ? shortenAddress(rev.payerWallet, 4) : '—'}
                      </td>

                      {/* Description */}
                      <td className="py-3.5 text-slate-300">
                        <div className="font-semibold text-white">{rev.description}</div>
                        {rev.subDescription && (
                          <div className="text-[10px] text-slate-400">{rev.subDescription}</div>
                        )}
                      </td>

                      {/* Fee Amount */}
                      <td className="py-3.5 font-mono text-purple-300 font-black whitespace-nowrap">
                        +{rev.feeAmountDisplay}
                      </td>

                      {/* Token */}
                      <td className="py-3.5 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-200 border border-slate-700/60 font-mono font-bold text-[11px]">
                          {rev.token}
                        </span>
                      </td>

                      {/* Network */}
                      <td className="py-3.5 whitespace-nowrap uppercase text-[11px] font-semibold text-slate-400">
                        {rev.network}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 whitespace-nowrap">
                        {rev.feeStatus === 'confirmed' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Confirmed On-Chain</span>
                          </span>
                        ) : rev.feeStatus === 'pending' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <Clock className="w-3 h-3 animate-spin" />
                            <span>Pending Receipt</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            <XCircle className="w-3 h-3" />
                            <span>Uncollected / Failed</span>
                          </span>
                        )}
                      </td>

                      {/* Transaction Hash */}
                      <td className="py-3.5 text-right pr-2 font-mono whitespace-nowrap">
                        {(rev.feeTxHash || rev.txHash) ? (
                          <a
                            href={rev.feeExplorerUrl || rev.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:underline inline-flex items-center gap-1 font-bold"
                          >
                            <span>{shortenAddress(rev.feeTxHash || rev.txHash, 4)}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-VIEW: SWAP ANALYTICS */}
      {activeSubTab === 'swap_analytics' && (
        <AdminSwapAnalyticsView />
      )}

      {/* SUB-VIEW 2: ALL INVOICES */}
      {activeSubTab === 'invoices' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoices by merchant, id, or asset..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Showing {filteredInvoices.length} of {allInvoices.length} invoices
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="pb-3 pl-2">Invoice ID</th>
                  <th className="pb-3">Merchant</th>
                  <th className="pb-3">Product</th>
                  <th className="pb-3">Fiat Price</th>
                  <th className="pb-3">Receiving Asset</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3 text-right pr-2">Tx Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 pl-2 font-mono text-cyan-400 font-bold">{inv.id}</td>
                    <td className="py-3.5 text-white font-bold">{inv.merchantName}</td>
                    <td className="py-3.5 text-slate-300">{inv.productName}</td>
                    <td className="py-3.5 font-mono text-white">
                      {inv.fiatCurrency || 'USD'} {inv.fiatAmount.toLocaleString()}
                    </td>
                    <td className="py-3.5 font-mono text-cyan-300 font-bold">
                      {inv.targetAmount} {inv.targetToken}
                    </td>
                    <td className="py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        inv.status === 'paid'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      }`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3.5 text-right pr-2 font-mono">
                      {inv.paidTxHash ? (
                        <a
                          href={inv.explorerUrl || getExplorerTxUrl(inv.network, inv.paidTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:underline inline-flex items-center gap-1 font-bold"
                        >
                          <span>{shortenAddress(inv.paidTxHash, 4)}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: ALL RECEIPTS */}
      {activeSubTab === 'receipts' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search receipts by merchant or token..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Showing {filteredReceipts.length} of {allReceipts.length} receipts
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="pb-3 pl-2">Time</th>
                  <th className="pb-3">Merchant</th>
                  <th className="pb-3">Payer Address</th>
                  <th className="pb-3">Paid Token</th>
                  <th className="pb-3">USD Value</th>
                  <th className="pb-3">PayFlux Fee</th>
                  <th className="pb-3 text-right pr-2">Tx Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredReceipts.map((rcpt, idx) => (
                  <tr key={`${rcpt.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 pl-2 text-slate-400">
                      {new Date(rcpt.timestamp).toLocaleDateString()} {new Date(rcpt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3.5 text-white font-bold">{rcpt.merchantName}</td>
                    <td className="py-3.5 font-mono text-slate-400">
                      {shortenAddress(rcpt.payerAddress, 4)}
                    </td>
                    <td className="py-3.5 font-mono text-cyan-300 font-bold">
                      {rcpt.amountPaid} {rcpt.tokenSymbol}
                    </td>
                    <td className="py-3.5 font-mono text-emerald-400 font-bold">
                      ${rcpt.fiatValueUsd.toFixed(2)}
                    </td>
                    <td className="py-3.5 font-mono text-purple-300 font-bold">
                      +{rcpt.payfluxFeeDisplay || PAYFLUX_PLATFORM_FEE_DISPLAY}
                    </td>
                    <td className="py-3.5 text-right pr-2 font-mono">
                      <a
                        href={rcpt.explorerUrl || getExplorerTxUrl(rcpt.network, rcpt.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline inline-flex items-center gap-1 font-bold"
                      >
                        <span>{shortenAddress(rcpt.txHash, 4)}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-VIEW 4: EXPANDABLE ADMIN ACCESS MANAGEMENT */}
      {activeSubTab === 'admins' && (
        <AdminManagementPanel />
      )}
    </div>
  );
};
