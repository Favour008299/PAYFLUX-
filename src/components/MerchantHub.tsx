import React, { useState, useEffect, useMemo } from 'react';
import {
  Store,
  QrCode,
  Copy,
  CheckCircle2,
  Clock,
  ExternalLink,
  Edit3,
  Save,
  Share2,
  DollarSign,
  TrendingUp,
  Receipt,
  AlertCircle,
  Sparkles,
  ArrowUpRight,
  Wallet,
  Download,
  Info,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown
} from 'lucide-react';
import { useAppKitAccount } from '@reown/appkit/react';
import confetti from 'canvas-confetti';
import { QRCodeDisplay } from './QRCodeDisplay';

import {
  MerchantInvoice,
  WalletAccount,
  Token,
  UserSettings,
  NetworkType
} from '../types';
import {
  saveMerchantInvoice,
  getMerchantInvoices,
  getMerchantProfile,
  saveMerchantProfile,
  subscribeToPaymentUpdates
} from '../services/paymentStorage';
import {
  MerchantProfile,
  SUPPORTED_FIAT_CURRENCIES,
  PAYFLUX_PLATFORM_FEE_USD
} from '../config/platform';
import { calculatePaymentQuote } from '../services/livePricing';
import { shortenAddress, formatCurrency, isValidEVMAddress } from '../utils/crypto';
import { getExplorerTxUrl } from '../services/contractConfig';
import { TokenIcon } from './TokenIcon';

interface MerchantHubProps {
  wallet: WalletAccount | null;
  tokens: Token[];
  settings: UserSettings;
  onOpenConnectModal: () => void;
  onOpenCustomerCheckoutWithInvoice: (invoiceId: string) => void;
}

const SUPPORTED_RECEIVING_ASSETS = [
  { symbol: 'VERSE', name: 'Verse Token', network: 'polygon' as NetworkType, networkLabel: 'Polygon' },
  { symbol: 'POL', name: 'Polygon Native (POL)', network: 'polygon' as NetworkType, networkLabel: 'Polygon' },
  { symbol: 'USDT', name: 'Tether USD', network: 'polygon' as NetworkType, networkLabel: 'Polygon' },
  { symbol: 'USDC', name: 'USD Coin', network: 'polygon' as NetworkType, networkLabel: 'Polygon' },
  { symbol: 'DAI', name: 'Dai Stablecoin', network: 'polygon' as NetworkType, networkLabel: 'Polygon' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', network: 'polygon' as NetworkType, networkLabel: 'Polygon' },
  { symbol: 'VERSE', name: 'Verse Token (Ethereum)', network: 'ethereum' as NetworkType, networkLabel: 'Ethereum' },
  { symbol: 'ETH', name: 'Ethereum Native (ETH)', network: 'ethereum' as NetworkType, networkLabel: 'Ethereum' },
];

export const MerchantHub: React.FC<MerchantHubProps> = ({
  wallet,
  tokens,
  settings,
  onOpenConnectModal,
  onOpenCustomerCheckoutWithInvoice,
}) => {
  const { address: connectedAddress, isConnected } = useAppKitAccount();

  // The merchant's connected wallet address is automatically associated with their merchant profile
  const activeMerchantAddress = connectedAddress || wallet?.address || '0x249cA82617eC3DfB2589c4c17ab7EC9765350a18';

  // Profile Form States
  const [merchantName, setMerchantName] = useState<string>("Favour's Kitchen");
  const [productName, setProductName] = useState<string>('Jollof Rice');
  const [priceAmount, setPriceAmount] = useState<string>('5000');
  const [currency, setCurrency] = useState<string>('NGN');
  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number>(0); // 0 = VERSE on Polygon

  // Profile Edit / Saved Mode
  const [isEditingProfile, setIsEditingProfile] = useState<boolean>(false);
  const [profileSaveSuccess, setProfileSaveSuccess] = useState<boolean>(false);

  // Invoices & Payment requests for this specific merchant
  const [merchantInvoices, setMerchantInvoices] = useState<MerchantInvoice[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'paid' | 'awaiting_payment'>('all');

  // Load merchant profile from storage on address change
  useEffect(() => {
    if (activeMerchantAddress) {
      const savedProfile = getMerchantProfile(activeMerchantAddress);
      if (savedProfile) {
        setMerchantName(savedProfile.merchantName);
        setProductName(savedProfile.productName);
        setPriceAmount(savedProfile.priceAmount.toString());
        setCurrency(savedProfile.currency);
        const idx = SUPPORTED_RECEIVING_ASSETS.findIndex(
          (a) => a.symbol === savedProfile.receivingAsset && a.network === savedProfile.receivingNetwork
        );
        if (idx >= 0) setSelectedAssetIndex(idx);
      }
    }
  }, [activeMerchantAddress]);

  // Load invoices scoped exclusively to this merchant
  const loadScopedInvoices = () => {
    const list = getMerchantInvoices(activeMerchantAddress);
    setMerchantInvoices(list);
  };

  useEffect(() => {
    loadScopedInvoices();
    const unsubscribe = subscribeToPaymentUpdates((invoiceId) => {
      loadScopedInvoices();
      const updatedList = getMerchantInvoices(activeMerchantAddress);
      const target = updatedList.find((i) => i.id === invoiceId);
      if (target && target.status === 'paid') {
        confetti({
          particleCount: 90,
          spread: 70,
          origin: { y: 0.6 },
        });
      }
    });
    return () => unsubscribe();
  }, [activeMerchantAddress]);

  const selectedReceivingAsset = SUPPORTED_RECEIVING_ASSETS[selectedAssetIndex] || SUPPORTED_RECEIVING_ASSETS[0];

  // Save Merchant Profile
  const handleSaveProfile = () => {
    const numPrice = parseFloat(priceAmount) || 0;
    const profile: MerchantProfile = {
      merchantName: merchantName.trim() || 'Store Merchant',
      productName: productName.trim() || 'Product',
      priceAmount: numPrice > 0 ? numPrice : 5000,
      currency,
      receivingAsset: selectedReceivingAsset.symbol,
      receivingNetwork: selectedReceivingAsset.network as 'polygon' | 'ethereum',
      walletAddress: activeMerchantAddress,
      updatedAt: Date.now(),
    };

    saveMerchantProfile(profile);
    setIsEditingProfile(false);
    setProfileSaveSuccess(true);
    setTimeout(() => setProfileSaveSuccess(false), 3000);

    // Also auto-generate an active invoice for this product configuration
    createInvoiceForProfile(profile);
  };

  // Create an invoice from profile
  const createInvoiceForProfile = async (profile: MerchantProfile) => {
    const fiatInfo = SUPPORTED_FIAT_CURRENCIES[profile.currency] || SUPPORTED_FIAT_CURRENCIES.USD;
    const amountInUsd = profile.currency === 'USD' ? profile.priceAmount : profile.priceAmount / (fiatInfo.rate || 1);

    const quote = await calculatePaymentQuote({
      amountDueUsd: amountInUsd,
      payTokenSymbol: profile.receivingAsset,
    });

    const newInvoice: MerchantInvoice = {
      id: `inv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      merchantName: profile.merchantName,
      merchantAddress: profile.walletAddress,
      productName: profile.productName,
      fiatAmount: profile.priceAmount,
      fiatCurrency: profile.currency,
      targetToken: profile.receivingAsset,
      targetAmount: parseFloat(quote.tokenAmount) || 0,
      network: profile.receivingNetwork,
      chainId: profile.receivingNetwork === 'ethereum' ? 1 : 137,
      status: 'awaiting_payment',
      createdAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
    };

    saveMerchantInvoice(newInvoice);
    loadScopedInvoices();
  };

  // The unique PayFlux QR Code Payload for this Merchant
  // Encodes the PayFlux protocol URI so any camera or customer scanner reads it seamlessly
  const currentFiat = SUPPORTED_FIAT_CURRENCIES[currency] || SUPPORTED_FIAT_CURRENCIES.USD;
  const qrCodePayload = useMemo(() => {
    const numPrice = parseFloat(priceAmount) || 0;
    const params = new URLSearchParams({
      address: activeMerchantAddress,
      merchant: merchantName,
      product: productName,
      price: numPrice.toString(),
      currency: currency,
      receiveToken: selectedReceivingAsset.symbol,
      network: selectedReceivingAsset.network,
    });
    return `payflux:checkout?${params.toString()}`;
  }, [activeMerchantAddress, merchantName, productName, priceAmount, currency, selectedReceivingAsset]);

  // Handle Copy Actions
  const handleCopyAddress = () => {
    navigator.clipboard.writeText(activeMerchantAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleCopyQRLink = () => {
    navigator.clipboard.writeText(qrCodePayload);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Merchant Revenue & Payments Calculations (excluding PayFlux fees)
  const paidInvoices = merchantInvoices.filter((i) => i.status === 'paid');
  const totalMerchantRevenueUsd = paidInvoices.reduce((acc, curr) => {
    const fiatInfo = SUPPORTED_FIAT_CURRENCIES[curr.fiatCurrency || 'USD'] || SUPPORTED_FIAT_CURRENCIES.USD;
    const usdVal = (curr.fiatCurrency === 'USD' || !curr.fiatCurrency)
      ? curr.fiatAmount
      : curr.fiatAmount / (fiatInfo.rate || 1);
    return acc + usdVal;
  }, 0);

  const filteredInvoices = merchantInvoices.filter((i) => {
    if (activeFilter === 'paid') return i.status === 'paid';
    if (activeFilter === 'awaiting_payment') return i.status === 'awaiting_payment' || i.status === 'confirming';
    return true;
  });

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-6 rounded-3xl shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="p-3.5 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-slate-950 font-bold shadow-lg shadow-cyan-500/20">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-white">PayFlux Merchant Terminal</h1>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                Non-Custodial
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Direct-to-wallet customer payments with zero custodial risk. All funds settle directly to your connected wallet.
            </p>
          </div>
        </div>

        {/* Connected Merchant Wallet Card */}
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-2xl bg-slate-950/80 border border-slate-800 text-left">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1">
              <Wallet className="w-3 h-3 text-cyan-400" />
              <span>Merchant Receiving Wallet</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-xs font-bold text-white">
                {shortenAddress(activeMerchantAddress, 5)}
              </span>
              <button
                onClick={handleCopyAddress}
                className="text-slate-400 hover:text-cyan-300 transition-colors p-1"
                title="Copy Address"
              >
                {copiedAddress ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          {!isConnected && (
            <button
              onClick={onOpenConnectModal}
              className="px-3.5 py-2 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors shadow-md"
            >
              Connect Real Wallet
            </button>
          )}
        </div>
      </div>

      {/* Main Split: Merchant Profile & QR Terminal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Merchant Profile Setup & Edit (6 cols) */}
        <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-xs">
                1
              </div>
              <h2 className="font-extrabold text-base text-white">Merchant Setup</h2>
            </div>
            <button
              onClick={() => setIsEditingProfile(!isEditingProfile)}
              className="flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isEditingProfile ? 'Cancel Edit' : 'Edit Profile'}</span>
            </button>
          </div>

          {profileSaveSuccess && (
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>Merchant profile and payment QR updated successfully!</span>
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Merchant / Business Name */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Merchant / Business Name
              </label>
              <input
                type="text"
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                disabled={!isEditingProfile}
                placeholder="e.g. Favour's Kitchen"
                className={`w-full px-4 py-2.5 rounded-2xl bg-slate-950 border text-sm font-semibold text-white placeholder-slate-500 focus:outline-none transition-all ${
                  isEditingProfile
                    ? 'border-cyan-500/60 focus:border-cyan-400'
                    : 'border-slate-800 opacity-90 cursor-default'
                }`}
              />
            </div>

            {/* Product Name */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Product Name
              </label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                disabled={!isEditingProfile}
                placeholder="e.g. Jollof Rice"
                className={`w-full px-4 py-2.5 rounded-2xl bg-slate-950 border text-sm font-semibold text-white placeholder-slate-500 focus:outline-none transition-all ${
                  isEditingProfile
                    ? 'border-cyan-500/60 focus:border-cyan-400'
                    : 'border-slate-800 opacity-90 cursor-default'
                }`}
              />
            </div>

            {/* Product Price & Currency */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Product Price
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                    {currentFiat.symbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(e.target.value)}
                    disabled={!isEditingProfile}
                    placeholder="5000"
                    className={`w-full pl-8 pr-4 py-2.5 rounded-2xl bg-slate-950 border text-sm font-mono font-bold text-white placeholder-slate-500 focus:outline-none transition-all ${
                      isEditingProfile
                        ? 'border-cyan-500/60 focus:border-cyan-400'
                        : 'border-slate-800 opacity-90 cursor-default'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Price Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={!isEditingProfile}
                  className={`w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border text-sm font-semibold text-white focus:outline-none transition-all ${
                    isEditingProfile
                      ? 'border-cyan-500/60 focus:border-cyan-400'
                      : 'border-slate-800 opacity-90 cursor-default'
                  }`}
                >
                  {Object.entries(SUPPORTED_FIAT_CURRENCIES).map(([code, details]) => (
                    <option key={code} value={code}>
                      {code} ({details.symbol}) - {details.label.split('(')[0]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Merchant Receiving Crypto Asset */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Merchant Receiving Crypto Asset
              </label>
              <div className="space-y-2">
                <select
                  value={selectedAssetIndex}
                  onChange={(e) => setSelectedAssetIndex(parseInt(e.target.value, 10))}
                  disabled={!isEditingProfile}
                  className={`w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border text-sm font-semibold text-white focus:outline-none transition-all ${
                    isEditingProfile
                      ? 'border-cyan-500/60 focus:border-cyan-400'
                      : 'border-slate-800 opacity-90 cursor-default'
                  }`}
                >
                  {SUPPORTED_RECEIVING_ASSETS.map((asset, idx) => (
                    <option key={`${asset.symbol}-${asset.network}-${idx}`} value={idx}>
                      {asset.symbol} on {asset.networkLabel} ({asset.name})
                    </option>
                  ))}
                </select>

                <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Selected Payout:</span>
                    <span className="font-bold text-cyan-300">
                      {selectedReceivingAsset.symbol}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {selectedReceivingAsset.networkLabel}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Direct Payout to Connected Wallet
                  </span>
                </div>
              </div>
            </div>

            {/* Save Profile Button */}
            {isEditingProfile && (
              <button
                onClick={handleSaveProfile}
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 mt-2"
              >
                <Save className="w-4 h-4" />
                <span>Save Profile & Update QR Code</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Unique PayFlux Merchant QR Code (6 cols) */}
        <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-6 flex flex-col items-center text-center">
          <div className="w-full flex items-center justify-between text-left">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-xs">
                2
              </div>
              <div>
                <h2 className="font-extrabold text-base text-white">Merchant QR Code</h2>
                <p className="text-[11px] text-slate-400">Unique PayFlux Payment Identifier</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              <span>Instant Scan</span>
            </span>
          </div>

          {/* The High-Contrast QR Code */}
          <div className="p-4 sm:p-5 rounded-3xl bg-white shadow-2xl border-4 border-cyan-500/30 flex items-center justify-center relative my-2">
            <QRCodeDisplay
              value={qrCodePayload}
              size={210}
            />
          </div>

          {/* QR Summary Tag */}
          <div className="w-full p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-left space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Merchant Name:</span>
              <span className="font-bold text-white">{merchantName}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Product / Item:</span>
              <span className="font-bold text-cyan-300">{productName}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Item Price:</span>
              <span className="font-bold font-mono text-emerald-400">
                {currentFiat.symbol}{parseFloat(priceAmount || '0').toLocaleString()} {currency}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Receiving Asset:</span>
              <span className="font-bold font-mono text-purple-300">
                {selectedReceivingAsset.symbol} ({selectedReceivingAsset.networkLabel})
              </span>
            </div>
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span>Payout Wallet:</span>
              <span className="font-mono text-slate-400">{shortenAddress(activeMerchantAddress, 5)}</span>
            </div>
          </div>

          {/* Actions: Copy Link & Test Customer Checkout */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleCopyQRLink}
              className="py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
            >
              {copiedLink ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Payload Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy QR URI</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                if (merchantInvoices.length > 0) {
                  onOpenCustomerCheckoutWithInvoice(merchantInvoices[0].id);
                } else {
                  handleSaveProfile();
                }
              }}
              className="py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-cyan-500/20"
            >
              <span>Test Pay As Customer</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Merchant Dashboard: Revenue & Received Payments (Scoped strictly to this merchant) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-xs">
              3
            </div>
            <div>
              <h2 className="font-extrabold text-base text-white">Merchant Dashboard</h2>
              <p className="text-xs text-slate-400">
                Payment history and revenue belonging to wallet: <span className="font-mono text-cyan-300">{shortenAddress(activeMerchantAddress, 5)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-400 font-bold">
              Merchant Revenue: ${totalMerchantRevenueUsd.toFixed(2)}
            </div>
            <button
              onClick={loadScopedInvoices}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Refresh Invoices"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              activeFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            All Invoices ({merchantInvoices.length})
          </button>
          <button
            onClick={() => setActiveFilter('paid')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              activeFilter === 'paid' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Settled Payments ({paidInvoices.length})
          </button>
          <button
            onClick={() => setActiveFilter('awaiting_payment')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              activeFilter === 'awaiting_payment' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            Awaiting Payment ({merchantInvoices.filter((i) => i.status === 'awaiting_payment' || i.status === 'confirming').length})
          </button>
        </div>

        {/* Invoices List Table */}
        {filteredInvoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="pb-3 pl-2">Created</th>
                  <th className="pb-3">Product / Service</th>
                  <th className="pb-3">Price / Currency</th>
                  <th className="pb-3">Receiving Asset</th>
                  <th className="pb-3">Paid Token</th>
                  <th className="pb-3">Status</th>
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
                    <td className="py-3 font-mono font-bold text-white">
                      {inv.fiatCurrency || 'USD'} {inv.fiatAmount.toLocaleString()}
                    </td>
                    <td className="py-3 font-mono text-cyan-300">
                      {inv.targetAmount} {inv.targetToken} ({inv.network})
                    </td>
                    <td className="py-3 font-mono text-slate-300">
                      {inv.paidToken ? `${inv.paidAmount} ${inv.paidToken}` : '—'}
                    </td>
                    <td className="py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          inv.status === 'paid'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : inv.status === 'confirming'
                            ? 'bg-amber-500/20 text-amber-400 animate-pulse border border-amber-500/30'
                            : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        }`}
                      >
                        {inv.status.replace('_', ' ')}
                      </span>
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
                        <button
                          onClick={() => onOpenCustomerCheckoutWithInvoice(inv.id)}
                          className="text-[11px] text-cyan-400 hover:underline font-bold"
                        >
                          Open Checkout
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500 text-xs space-y-2">
            <Receipt className="w-8 h-8 mx-auto text-slate-600" />
            <p className="font-bold text-slate-400">No merchant payment invoices yet.</p>
            <p>Save your profile above to generate your payment QR code and accept real customer payments.</p>
          </div>
        )}
      </div>
    </div>
  );
};
