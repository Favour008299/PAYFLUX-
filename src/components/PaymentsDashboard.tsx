import React, { useState, useEffect } from 'react';
import {
  Receipt,
  Store,
  Wallet,
  ExternalLink,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Coins,
  ShieldCheck,
  Building2,
  Layers,
  ChevronRight,
  RefreshCw,
  BarChart3,
  Users,
  Sparkles,
  Activity,
  AlertCircle,
  Lock,
  ShieldAlert,
  KeyRound,
  LogOut,
  Copy,
  Check,
  ArrowRightLeft
} from 'lucide-react';
import { useAppKitAccount } from '@reown/appkit/react';

import {
  WalletAccount,
  Token,
  CustomerPaymentReceipt,
  MerchantInvoice,
  PlatformAnalytics,
  UserSettings,
} from '../types';
import {
  getCustomerReceipts,
  getMerchantInvoices,
  getPlatformAnalytics,
  subscribeToPaymentUpdates,
} from '../services/paymentStorage';
import {
  PAYFLUX_PLATFORM_FEE_USD,
  PAYFLUX_TREASURY_ADDRESS,
  AUTHORIZED_ADMIN_ADDRESSES,
  isAuthorizedAdmin
} from '../config/platform';
import { shortenAddress } from '../utils/crypto';
import { getExplorerTxUrl } from '../services/contractConfig';
import { useAdminAuth } from '../context/AdminAuthContext';
import { AdminLoginCard } from './AdminLoginCard';
import { AdminManagementPanel } from './AdminManagementPanel';
import { AdminSwapAnalyticsView } from './AdminSwapAnalyticsView';
import { PRIMARY_ADMIN_EMAIL } from '../services/adminAuthService';

interface PaymentsDashboardProps {
  wallet: WalletAccount | null;
  tokens: Token[];
  settings: UserSettings;
  onOpenConnectModal: () => void;
  onOpenCheckout?: (invId?: string) => void;
  onOpenMerchantHub?: () => void;
}

export const PaymentsDashboard: React.FC<PaymentsDashboardProps> = ({
  wallet,
  tokens,
  settings,
  onOpenConnectModal,
  onOpenCheckout,
  onOpenMerchantHub,
}) => {
  const { address: connectedAddress } = useAppKitAccount();
  const activeAddress = connectedAddress || wallet?.address || '';

  const { user, adminRecord, isAdmin, isSuperAdmin, loading: authLoading, logout, refreshAdminStatus } = useAdminAuth();

  const [activeTab, setActiveTab] = useState<'customer' | 'merchant' | 'admin'>('customer');
  const [customerReceipts, setCustomerReceipts] = useState<CustomerPaymentReceipt[]>([]);
  const [merchantInvoices, setMerchantInvoices] = useState<MerchantInvoice[]>([]);
  const [platformAnalytics, setPlatformAnalytics] = useState<PlatformAnalytics>(getPlatformAnalytics());
  const [searchQuery, setSearchQuery] = useState('');
  const [adminViewSection, setAdminViewSection] = useState<'telemetry' | 'swap_analytics' | 'management'>('telemetry');
  const [copiedRevenueAddress, setCopiedRevenueAddress] = useState(false);

  const handleCopyRevenueAddress = () => {
    navigator.clipboard.writeText(PAYFLUX_TREASURY_ADDRESS);
    setCopiedRevenueAddress(true);
    setTimeout(() => setCopiedRevenueAddress(false), 2000);
  };

  const loadData = () => {
    setCustomerReceipts(getCustomerReceipts(activeAddress));
    setMerchantInvoices(getMerchantInvoices(activeAddress));
    setPlatformAnalytics(getPlatformAnalytics());
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToPaymentUpdates(() => {
      loadData();
    });
    return () => unsubscribe();
  }, [activeAddress]);

  // Filtered Customer Receipts (Scoped to this customer)
  const filteredReceipts = customerReceipts.filter((rcpt) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      rcpt.merchantName.toLowerCase().includes(q) ||
      rcpt.productName.toLowerCase().includes(q) ||
      rcpt.txHash.toLowerCase().includes(q) ||
      rcpt.tokenSymbol.toLowerCase().includes(q)
    );
  });

  // Filtered Merchant Invoices (Scoped to this merchant)
  const filteredInvoices = merchantInvoices.filter((inv) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      inv.merchantName.toLowerCase().includes(q) ||
      inv.productName.toLowerCase().includes(q) ||
      inv.id.toLowerCase().includes(q) ||
      inv.targetToken.toLowerCase().includes(q)
    );
  });

  // Totals
  const totalCustomerPaidUsd = customerReceipts.reduce((acc, curr) => acc + curr.fiatValueUsd, 0);
  const totalMerchantReceivedUsd = merchantInvoices
    .filter((i) => i.status === 'paid')
    .reduce((acc, curr) => acc + curr.fiatAmount, 0);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-6 rounded-3xl shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="p-3.5 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-slate-950 font-bold shadow-lg shadow-cyan-500/20">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">Payment Ledger & Analytics</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Personal customer payment records, merchant settlement logs, and PayFlux admin telemetry.
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 self-start md:self-auto">
          <button
            onClick={() => setActiveTab('customer')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-all ${
              activeTab === 'customer'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Customer Ledger ({customerReceipts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('merchant')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-all ${
              activeTab === 'merchant'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>Merchant Ledger ({merchantInvoices.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('admin')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-all ${
              activeTab === 'admin'
                ? 'bg-gradient-to-r from-purple-500 to-cyan-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>PayFlux Admin</span>
          </button>
        </div>
      </div>

      {/* Role Flexibility Notice */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>Active Connected Address:</span>
          <span className="font-mono text-white font-bold">
            {activeAddress ? shortenAddress(activeAddress, 6) : 'No Wallet Connected'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500">Dual Roles Active:</span>
          <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 font-bold">
            Customer & Merchant
          </span>
        </div>
      </div>

      {/* Summary Stat Cards for Customer */}
      {activeTab === 'customer' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1.5">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Total Spent by Your Wallet
            </div>
            <div className="text-2xl font-black text-white font-mono">
              ${totalCustomerPaidUsd.toFixed(2)} USD
            </div>
            <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>Real On-Chain Blockchain Receipts</span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1.5">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Total PayFlux Fees Paid
            </div>
            <div className="text-2xl font-black text-cyan-300 font-mono">
              ${(customerReceipts.length * PAYFLUX_PLATFORM_FEE_USD).toFixed(2)} USD
            </div>
            <div className="text-[10px] text-slate-400">$0.10 per successful transaction</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1.5">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Payments Completed
            </div>
            <div className="text-2xl font-black text-white font-mono">{customerReceipts.length}</div>
            <div className="text-[10px] text-slate-400">Direct non-custodial settlements</div>
          </div>
        </div>
      )}

      {/* Summary Stat Cards for Merchant */}
      {activeTab === 'merchant' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-emerald-500/30 p-5 rounded-3xl space-y-1.5">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
              Total Merchant Sales
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              ${totalMerchantReceivedUsd.toFixed(2)} USD
            </div>
            <div className="text-[10px] text-slate-400">Zero gateway fees deducted</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1.5">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Invoices Settled
            </div>
            <div className="text-2xl font-black text-white font-mono">
              {merchantInvoices.filter((i) => i.status === 'paid').length} / {merchantInvoices.length}
            </div>
            <div className="text-[10px] text-slate-400">Direct to merchant receiving wallet</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1.5">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Merchant Settlement Status
            </div>
            <div className="text-2xl font-black text-cyan-300 font-mono">100% Direct</div>
            <div className="text-[10px] text-slate-400">Immediate on-chain wallet arrival</div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ADMIN VIEW: PROTECTED FIREBASE AUTH + EXPANDABLE RBAC BARRIER */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'admin' && (
        <>
          {authLoading ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-3">
              <RefreshCw className="w-8 h-8 mx-auto text-cyan-400 animate-spin" />
              <h3 className="font-bold text-white text-sm">Verifying PayFlux Admin Authorization...</h3>
              <p className="text-xs text-slate-400 font-mono">Checking against secure owner & RBAC registry</p>
            </div>
          ) : !isAdmin ? (
            /* ACCESS GATE SCREEN (FIREBASE AUTHENTICATION REQUIRED) */
            <div className="space-y-6">
              <AdminLoginCard />
              {user && (
                <div className="max-w-md mx-auto p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-center space-y-2">
                  <div className="flex items-center justify-center gap-2 text-rose-400 font-bold text-xs">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Access Denied</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Authenticated as <strong className="text-white font-mono">{user.email}</strong>. This account is not an authorized administrator.
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Only <strong className="text-cyan-300">{PRIMARY_ADMIN_EMAIL}</strong> or invited admins can view this ledger.
                  </p>
                  <button
                    onClick={logout}
                    className="mt-2 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold transition-colors"
                  >
                    Sign Out & Retry
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* AUTHORIZED ADMIN ANALYTICS & RBAC MANAGEMENT DASHBOARD */
            <div className="space-y-6 animate-fadeIn">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-bold">
                    Admin Authenticated: <span className="text-white">{user?.email}</span> ({adminRecord?.role || (isSuperAdmin ? 'Super Admin / Owner' : 'Admin')})
                  </span>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    onClick={refreshAdminStatus}
                    className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-[11px] font-bold hover:bg-emerald-900/60 transition-colors"
                  >
                    Refresh Status
                  </button>
                  <button
                    onClick={logout}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[11px] font-bold hover:bg-rose-500/30 transition-colors"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>

              {/* Sub-tab switcher for Admin: Telemetry vs Swap Analytics vs RBAC */}
              <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 flex-wrap">
                <button
                  onClick={() => setAdminViewSection('telemetry')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    adminViewSection === 'telemetry'
                      ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-slate-950 shadow-md shadow-purple-950/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Platform Revenue & Telemetry</span>
                </button>
                <button
                  onClick={() => setAdminViewSection('swap_analytics')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    adminViewSection === 'swap_analytics'
                      ? 'bg-gradient-to-r from-cyan-500 to-purple-600 text-slate-950 shadow-md shadow-cyan-950/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Swap Analytics</span>
                </button>
                <button
                  onClick={() => setAdminViewSection('management')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    adminViewSection === 'management'
                      ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-slate-950 shadow-md shadow-purple-950/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Admin Access Management</span>
                </button>
              </div>

              {adminViewSection === 'swap_analytics' ? (
                <AdminSwapAnalyticsView />
              ) : adminViewSection === 'telemetry' ? (
                <>
                  {/* Admin Metric Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-slate-900 border border-purple-500/30 p-5 rounded-3xl space-y-1">
                      <div className="text-[10px] uppercase font-bold text-purple-300 tracking-wider flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span>PayFlux Fee Revenue</span>
                      </div>
                      <div className="text-2xl font-black text-purple-300 font-mono">
                        ${platformAnalytics.totalPayfluxRevenueUsd.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400">Fixed $0.10 / successful payment</div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Total Transaction Volume
                      </div>
                      <div className="text-2xl font-black text-white font-mono">
                        ${platformAnalytics.totalVolumeUsd.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400">Across all platform checkouts</div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Total Successful Payments
                      </div>
                      <div className="text-2xl font-black text-cyan-300 font-mono">
                        {platformAnalytics.successfulCount}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-bold">
                        {platformAnalytics.failedCount} Failed
                      </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Active Merchants / Users
                      </div>
                      <div className="text-2xl font-black text-white font-mono">
                        {platformAnalytics.totalMerchantsCount} Merchants
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {platformAnalytics.totalCustomersCount} Active Customers
                      </div>
                    </div>
                  </div>

                  {/* Dedicated Swap Analytics Jump Banner */}
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
                          Audit swap attempts, on-chain confirmations, volume, most-used trading pairs, and failure reasons in real-time.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setAdminViewSection('swap_analytics')}
                      className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 text-xs font-black shadow-lg shadow-cyan-950/40 transition-all flex items-center gap-2 whitespace-nowrap"
                    >
                      <span>Open Swap Analytics</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Dedicated Polygon Revenue Destination Card */}
                  <div className="bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-purple-500/40 rounded-3xl p-6 space-y-4 shadow-xl">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          <Wallet className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-black text-white">Fixed Polygon Revenue Wallet</h3>
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              Polygon PoS
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">
                            Fixed platform recipient for $0.10 fees generated across customer checkouts
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopyRevenueAddress}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700"
                        >
                          {copiedRevenueAddress ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedRevenueAddress ? 'Copied' : 'Copy'}</span>
                        </button>
                        <a
                          href={`https://polygonscan.com/address/${PAYFLUX_TREASURY_ADDRESS}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-bold transition-all"
                        >
                          <span>Polygonscan</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <span className="text-slate-400">Receiving Address:</span>
                      <span className="font-mono text-cyan-300 font-bold break-all">
                        {PAYFLUX_TREASURY_ADDRESS}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-emerald-400 font-medium">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>Public receiving address only — private keys and seed phrases remain completely outside the app.</span>
                    </div>
                  </div>
                </>
              ) : (
                <AdminManagementPanel />
              )}
            </div>
          )}
        </>
      )}

      {/* Main Records Table (for Customer, Merchant, or Authorized Admin) */}
      {(activeTab !== 'admin' || (isAdmin && adminViewSection === 'telemetry')) && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by merchant, asset, or hash..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <button
              onClick={loadData}
              className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-bold self-end sm:self-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Ledger</span>
            </button>
          </div>

          {/* CUSTOMER VIEW */}
          {activeTab === 'customer' && (
            <div>
              {filteredReceipts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                        <th className="pb-3 pl-2">Date & Time</th>
                        <th className="pb-3">Merchant</th>
                        <th className="pb-3">Product / Service</th>
                        <th className="pb-3">Amount Paid</th>
                        <th className="pb-3">PayFlux Fee</th>
                        <th className="pb-3">USD Value</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3 text-right pr-2">Tx Hash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-medium">
                      {filteredReceipts.map((rcpt, idx) => (
                        <tr key={`${rcpt.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 pl-2 text-slate-400">
                            {new Date(rcpt.timestamp).toLocaleDateString()} {new Date(rcpt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-3 text-white font-bold">{rcpt.merchantName}</td>
                          <td className="py-3 text-slate-300">{rcpt.productName}</td>
                          <td className="py-3 font-mono font-bold text-cyan-300">
                            {rcpt.amountPaid} {rcpt.tokenSymbol}
                          </td>
                          <td className="py-3 font-mono text-slate-400">
                            ${(rcpt.payfluxFeeUsd ?? PAYFLUX_PLATFORM_FEE_USD).toFixed(2)}
                          </td>
                          <td className="py-3 font-mono text-white">${rcpt.fiatValueUsd.toFixed(2)}</td>
                          <td className="py-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
                              {rcpt.status}
                            </span>
                          </td>
                          <td className="py-3 text-right pr-2 font-mono">
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
              ) : (
                <div className="text-center py-12 text-slate-500 text-xs space-y-2">
                  <Receipt className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="font-bold text-slate-400">No customer payment receipts found for this wallet.</p>
                  <p>When you scan a merchant QR and pay, your confirmed on-chain receipts will appear here.</p>
                </div>
              )}
            </div>
          )}

          {/* MERCHANT VIEW */}
          {activeTab === 'merchant' && (
            <div>
              {filteredInvoices.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                        <th className="pb-3 pl-2">Created</th>
                        <th className="pb-3">Product / Service</th>
                        <th className="pb-3">Price / Currency</th>
                        <th className="pb-3">Receiving Asset</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">Payer Address</th>
                        <th className="pb-3 text-right pr-2">Tx Hash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-medium">
                      {filteredInvoices.map((inv, idx) => (
                        <tr key={`${inv.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 pl-2 text-slate-400">
                            {new Date(inv.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-3 text-white font-bold">{inv.productName}</td>
                          <td className="py-3 font-mono text-white">
                            {inv.fiatCurrency || 'USD'} {inv.fiatAmount.toLocaleString()}
                          </td>
                          <td className="py-3 font-mono text-cyan-300">
                            {inv.targetAmount} {inv.targetToken}
                          </td>
                          <td className="py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                inv.status === 'paid'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                              }`}
                            >
                              {inv.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 font-mono text-slate-400">
                            {inv.payerAddress ? shortenAddress(inv.payerAddress, 4) : '—'}
                          </td>
                          <td className="py-3 text-right pr-2 font-mono">
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
              ) : (
                <div className="text-center py-12 text-slate-500 text-xs space-y-2">
                  <Store className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="font-bold text-slate-400">No merchant invoices created for this wallet yet.</p>
                  <p>Generate a payment request or QR in Merchant Hub to start receiving customer transfers.</p>
                </div>
              )}
            </div>
          )}

          {/* ADMIN VIEW */}
          {activeTab === 'admin' && isAdmin && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Recent Platform Checkouts</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {platformAnalytics.recentActivity.length} Recorded Transactions
                </span>
              </div>

              {platformAnalytics.recentActivity.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                        <th className="pb-3 pl-2">Time</th>
                        <th className="pb-3">Merchant</th>
                        <th className="pb-3">Payer</th>
                        <th className="pb-3">Volume ($)</th>
                        <th className="pb-3">PayFlux Fee ($)</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3 text-right pr-2">Tx Hash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-medium">
                      {platformAnalytics.recentActivity.map((act, idx) => (
                        <tr key={`${act.id}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 pl-2 text-slate-400">
                            {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-3 text-white font-bold">{act.merchantName}</td>
                          <td className="py-3 font-mono text-slate-400">{shortenAddress(act.payerAddress, 4)}</td>
                          <td className="py-3 font-mono text-emerald-400 font-bold">${act.fiatValueUsd.toFixed(2)}</td>
                          <td className="py-3 font-mono text-purple-300 font-bold">
                            +${(act.payfluxFeeUsd ?? PAYFLUX_PLATFORM_FEE_USD).toFixed(2)}
                          </td>
                          <td className="py-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                              {act.status}
                            </span>
                          </td>
                          <td className="py-3 text-right pr-2 font-mono">
                            <a
                              href={act.explorerUrl || getExplorerTxUrl(act.network, act.txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:underline inline-flex items-center gap-1 font-bold"
                            >
                              <span>{shortenAddress(act.txHash, 4)}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-10 text-slate-500 text-xs space-y-2">
                  <Activity className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="font-bold text-slate-400">Platform initialized with live telemetry.</p>
                  <p>All completed merchant checkouts will log here with real-time fee tracking.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
