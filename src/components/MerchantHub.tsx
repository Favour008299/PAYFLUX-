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
import { useAccount } from 'wagmi';
import confetti from 'canvas-confetti';
import { QRCodeDisplay } from './QRCodeDisplay';
import { trackEvent } from '../services/analytics';

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
  fetchMerchantProfile,
  saveMerchantProfile,
  subscribeToPaymentUpdates,
  subscribeToMerchantProfileUpdates
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
  const { address: connectedAddress, isConnected } = useAccount();

  // The merchant's connected wallet address is automatically associated with their merchant profile
  // When no wallet is connected, this MUST remain empty - no fake or placeholder wallet address should ever appear!
  const activeMerchantAddress = (connectedAddress || wallet?.address || '') as string;
  const hasWallet = Boolean(activeMerchantAddress && activeMerchantAddress.startsWith('0x'));

  // Profile Form States - Empty defaults with faint placeholders
  const [merchantName, setMerchantName] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [priceAmount, setPriceAmount] = useState<string>('');
  const [currency, setCurrency] = useState<string>('');
  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number>(-1); // -1 = unselected

  // Profile Edit / Saved Mode
  const [hasSavedSetup, setHasSavedSetup] = useState<boolean>(false);
  const [isEditingProfile, setIsEditingProfile] = useState<boolean>(false);
  const [profileSaveSuccess, setProfileSaveSuccess] = useState<boolean>(false);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);

  // Invoices & Payment requests for this specific merchant
  const [merchantInvoices, setMerchantInvoices] = useState<MerchantInvoice[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'paid' | 'awaiting_payment'>('all');

  // Load merchant profile from storage and cloud on address change
  useEffect(() => {
    if (hasWallet && activeMerchantAddress) {
      const applyProfile = (savedProfile: MerchantProfile | null) => {
        if (
          savedProfile &&
          savedProfile.merchantName &&
          savedProfile.productName &&
          savedProfile.priceAmount > 0
        ) {
          setMerchantName(savedProfile.merchantName);
          setProductName(savedProfile.productName);
          setPriceAmount(savedProfile.priceAmount.toString());
          setCurrency(savedProfile.currency || 'USD');
          const idx = SUPPORTED_RECEIVING_ASSETS.findIndex(
            (a) => a.symbol === savedProfile.receivingAsset && a.network === savedProfile.receivingNetwork
          );
          if (idx >= 0) setSelectedAssetIndex(idx);
          else setSelectedAssetIndex(0);
          setHasSavedSetup(true);
          setIsEditingProfile(false);
        } else {
          // Fresh, completely empty merchant setup
          setMerchantName('');
          setProductName('');
          setPriceAmount('');
          setCurrency('');
          setSelectedAssetIndex(-1);
          setHasSavedSetup(false);
          setIsEditingProfile(true);
        }
      };

      const localProfile = getMerchantProfile(activeMerchantAddress);
      if (localProfile) {
        applyProfile(localProfile);
      } else {
        setHasSavedSetup(false);
        setIsEditingProfile(true);
      }

      fetchMerchantProfile(activeMerchantAddress).then((cloudProfile) => {
        if (cloudProfile) applyProfile(cloudProfile);
      });

      const unsubscribe = subscribeToMerchantProfileUpdates((addr) => {
        if (addr === '*' || addr.toLowerCase() === activeMerchantAddress.toLowerCase()) {
          const updated = getMerchantProfile(activeMerchantAddress);
          if (updated) applyProfile(updated);
        }
      });

      return () => unsubscribe();
    } else {
      setHasSavedSetup(false);
      setIsEditingProfile(true);
    }
  }, [activeMerchantAddress, hasWallet]);

  // Load invoices scoped exclusively to this merchant
  const loadScopedInvoices = () => {
    if (!hasWallet || !activeMerchantAddress) {
      setMerchantInvoices([]);
      return;
    }
    const list = getMerchantInvoices(activeMerchantAddress);
    setMerchantInvoices(list);
  };

  useEffect(() => {
    loadScopedInvoices();
    if (!hasWallet || !activeMerchantAddress) return;

    const unsubscribe = subscribeToPaymentUpdates((invoiceId) => {
      loadScopedInvoices();
      const updatedList = getMerchantInvoices(activeMerchantAddress);
      if (invoiceId) {
        const target = updatedList.find((i) => i.id === invoiceId);
        if (target && target.status === 'paid') {
          confetti({
            particleCount: 90,
            spread: 70,
            origin: { y: 0.6 },
          });
        }
      }
    });
    return () => unsubscribe();
  }, [activeMerchantAddress, hasWallet]);

  const selectedReceivingAsset =
    selectedAssetIndex >= 0 && selectedAssetIndex < SUPPORTED_RECEIVING_ASSETS.length
      ? SUPPORTED_RECEIVING_ASSETS[selectedAssetIndex]
      : null;

  // Save Merchant Profile
  const handleSaveProfile = () => {
    setFormValidationError(null);

    if (!hasWallet || !activeMerchantAddress) {
      onOpenConnectModal();
      return;
    }

    if (!merchantName.trim()) {
      setFormValidationError('Please enter your Business / Merchant Name.');
      return;
    }
    if (!productName.trim()) {
      setFormValidationError('Please enter your Product / Service Name.');
      return;
    }
    const numPrice = parseFloat(priceAmount);
    if (isNaN(numPrice) || numPrice <= 0) {
      setFormValidationError('Please enter a valid price greater than 0.');
      return;
    }
    if (!currency) {
      setFormValidationError('Please select a price currency.');
      return;
    }
    if (!selectedReceivingAsset) {
      setFormValidationError('Please select your receiving crypto asset.');
      return;
    }

    const profile: MerchantProfile = {
      merchantName: merchantName.trim(),
      productName: productName.trim(),
      priceAmount: numPrice,
      currency: currency,
      receivingAsset: selectedReceivingAsset.symbol,
      receivingNetwork: selectedReceivingAsset.network as 'polygon' | 'ethereum',
      walletAddress: activeMerchantAddress,
      updatedAt: Date.now(),
    };

    saveMerchantProfile(profile, true);
    setHasSavedSetup(true);
    setIsEditingProfile(false);
    setProfileSaveSuccess(true);
    setTimeout(() => setProfileSaveSuccess(false), 4000);

    // Also auto-generate an active invoice for this product configuration
    createInvoiceForProfile(profile);
  };

  // Create an invoice from profile
  const createInvoiceForProfile = async (profile: MerchantProfile) => {
    if (!profile.walletAddress || !profile.walletAddress.startsWith('0x')) return;

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

    trackEvent('invoice_created', {
      productName: newInvoice.productName,
      fiatAmount: newInvoice.fiatAmount,
      fiatCurrency: newInvoice.fiatCurrency,
      targetToken: newInvoice.targetToken,
      network: newInvoice.network,
    });
  };

  // The unique PayFlux QR Code Payload for this Merchant
  // Generated ONLY after merchant setup has been saved
  const currentFiat = currency && SUPPORTED_FIAT_CURRENCIES[currency]
    ? SUPPORTED_FIAT_CURRENCIES[currency]
    : SUPPORTED_FIAT_CURRENCIES.USD;

  const qrCodePayload = useMemo(() => {
    if (!hasSavedSetup || !hasWallet || !activeMerchantAddress || !selectedReceivingAsset) {
      return '';
    }
    const numPrice = parseFloat(priceAmount) || 0;
    if (numPrice <= 0 || !merchantName.trim() || !productName.trim() || !currency) {
      return '';
    }
    const params = new URLSearchParams({
      address: activeMerchantAddress,
      merchant: merchantName.trim(),
      product: productName.trim(),
      price: numPrice.toString(),
      currency: currency,
      receiveToken: selectedReceivingAsset.symbol,
      network: selectedReceivingAsset.network,
    });
    return `payflux:checkout?${params.toString()}`;
  }, [hasSavedSetup, hasWallet, activeMerchantAddress, merchantName, productName, priceAmount, currency, selectedReceivingAsset]);

  // Handle Copy Actions
  const handleCopyAddress = () => {
    if (!hasWallet || !activeMerchantAddress) return;
    navigator.clipboard.writeText(activeMerchantAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleCopyQRLink = () => {
    if (!qrCodePayload) {
      if (!hasWallet) onOpenConnectModal();
      return;
    }
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
          {hasWallet ? (
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
          ) : (
            <div className="px-4 py-2 rounded-2xl bg-slate-950/80 border border-amber-500/30 text-left flex items-center gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-amber-400" />
                  <span>Merchant Receiving Wallet</span>
                </div>
                <div className="mt-0.5">
                  <span className="text-xs font-bold text-amber-200">
                    Wallet Not Connected
                  </span>
                </div>
              </div>
            </div>
          )}

          {!hasWallet && (
            <button
              onClick={onOpenConnectModal}
              className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-1.5"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Connect Real Wallet</span>
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
              <div>
                <h2 className="font-extrabold text-base text-white">
                  {hasSavedSetup ? 'Merchant Profile' : 'Merchant Setup'}
                </h2>
                <p className="text-[11px] text-slate-400">
                  {hasSavedSetup
                    ? 'Saved configuration for receiving crypto payouts'
                    : 'Set up your product and receiving details to start'}
                </p>
              </div>
            </div>

            {/* Show "Edit Profile" only AFTER merchant has saved their setup */}
            {hasSavedSetup && (
              <button
                id="merchant-edit-profile-btn"
                onClick={() => {
                  if (!hasWallet) {
                    onOpenConnectModal();
                    return;
                  }
                  setIsEditingProfile(!isEditingProfile);
                  setFormValidationError(null);
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{isEditingProfile ? 'Cancel Edit' : 'Edit Profile'}</span>
              </button>
            )}
          </div>

          {!hasWallet && (
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400" />
                <span>Connect your merchant wallet to link customer payouts to your address.</span>
              </div>
              <button
                onClick={onOpenConnectModal}
                className="px-2.5 py-1 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-[11px] whitespace-nowrap transition-colors"
              >
                Connect
              </button>
            </div>
          )}

          {formValidationError && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{formValidationError}</span>
            </div>
          )}

          {profileSaveSuccess && (
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>Merchant setup saved & QR code generated successfully!</span>
            </div>
          )}

          {/* Form Fields - directly editable when new setup or editing */}
          <div className="space-y-4">
            {/* Merchant / Business Name */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Business / Merchant Name
              </label>
              <input
                id="merchant-name-input"
                type="text"
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                disabled={hasSavedSetup && !isEditingProfile}
                placeholder="Business / Merchant Name"
                className={`w-full px-4 py-2.5 rounded-2xl bg-slate-950 border text-sm font-semibold text-white placeholder-slate-600 focus:outline-none transition-all ${
                  (!hasSavedSetup || isEditingProfile)
                    ? 'border-cyan-500/60 focus:border-cyan-400 ring-1 ring-cyan-500/20'
                    : 'border-slate-800 opacity-90 cursor-default'
                }`}
              />
            </div>

            {/* Product Name */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Product / Service Name
              </label>
              <input
                id="product-name-input"
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                disabled={hasSavedSetup && !isEditingProfile}
                placeholder="Product / Service Name"
                className={`w-full px-4 py-2.5 rounded-2xl bg-slate-950 border text-sm font-semibold text-white placeholder-slate-600 focus:outline-none transition-all ${
                  (!hasSavedSetup || isEditingProfile)
                    ? 'border-cyan-500/60 focus:border-cyan-400 ring-1 ring-cyan-500/20'
                    : 'border-slate-800 opacity-90 cursor-default'
                }`}
              />
            </div>

            {/* Product Price & Currency */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Enter price
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                    {currency ? (currentFiat?.symbol || '$') : ''}
                  </span>
                  <input
                    id="price-amount-input"
                    type="number"
                    min="0"
                    step="any"
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(e.target.value)}
                    disabled={hasSavedSetup && !isEditingProfile}
                    placeholder="Enter price"
                    className={`w-full ${currency ? 'pl-8' : 'pl-4'} pr-4 py-2.5 rounded-2xl bg-slate-950 border text-sm font-mono font-bold text-white placeholder-slate-600 focus:outline-none transition-all ${
                      (!hasSavedSetup || isEditingProfile)
                        ? 'border-cyan-500/60 focus:border-cyan-400 ring-1 ring-cyan-500/20'
                        : 'border-slate-800 opacity-90 cursor-default'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  Select currency
                </label>
                <select
                  id="currency-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={hasSavedSetup && !isEditingProfile}
                  className={`w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border text-sm font-semibold text-white focus:outline-none transition-all ${
                    (!hasSavedSetup || isEditingProfile)
                      ? 'border-cyan-500/60 focus:border-cyan-400'
                      : 'border-slate-800 opacity-90 cursor-default'
                  } ${!currency ? 'text-slate-500' : ''}`}
                >
                  <option value="" disabled className="text-slate-500">
                    Select currency
                  </option>
                  {Object.entries(SUPPORTED_FIAT_CURRENCIES).map(([code, details]) => (
                    <option key={code} value={code} className="text-white bg-slate-950">
                      {code} ({details.symbol}) - {details.label.split('(')[0]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Merchant Receiving Crypto Asset */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Select receiving crypto
              </label>
              <div className="space-y-2">
                <select
                  id="receiving-asset-select"
                  value={selectedAssetIndex}
                  onChange={(e) => setSelectedAssetIndex(parseInt(e.target.value, 10))}
                  disabled={hasSavedSetup && !isEditingProfile}
                  className={`w-full px-3.5 py-2.5 rounded-2xl bg-slate-950 border text-sm font-semibold text-white focus:outline-none transition-all ${
                    (!hasSavedSetup || isEditingProfile)
                      ? 'border-cyan-500/60 focus:border-cyan-400'
                      : 'border-slate-800 opacity-90 cursor-default'
                  } ${selectedAssetIndex === -1 ? 'text-slate-500' : ''}`}
                >
                  <option value={-1} disabled className="text-slate-500">
                    Select receiving crypto
                  </option>
                  {SUPPORTED_RECEIVING_ASSETS.map((asset, idx) => (
                    <option key={`${asset.symbol}-${asset.network}-${idx}`} value={idx} className="text-white bg-slate-950">
                      {asset.symbol} on {asset.networkLabel} ({asset.name})
                    </option>
                  ))}
                </select>

                {selectedReceivingAsset && (
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
                )}
              </div>
            </div>

            {/* Clear Action Button: Create Setup vs Update Setup */}
            {(!hasSavedSetup || isEditingProfile) && (
              <button
                id="save-merchant-setup-btn"
                onClick={handleSaveProfile}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 mt-3 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{hasSavedSetup ? 'Save Changes & Update QR' : 'Create Merchant Setup'}</span>
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
                <p className="text-[11px] text-slate-400">
                  {hasSavedSetup ? 'Active PayFlux Payment Identifier' : 'Generates after setup is saved'}
                </p>
              </div>
            </div>
            {hasSavedSetup && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>Live QR</span>
              </span>
            )}
          </div>

            {/* Condition: Do NOT generate or display QR code until merchant setup is saved */}
          {hasSavedSetup && qrCodePayload ? (
            <>
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
                  <span className="text-slate-400">Product / Service:</span>
                  <span className="font-bold text-cyan-300">{productName}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Item Price:</span>
                  <span className="font-bold font-mono text-emerald-400">
                    {currentFiat.symbol}{parseFloat(priceAmount || '0').toLocaleString()} {currency}
                  </span>
                </div>
                {selectedReceivingAsset && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Receiving Asset:</span>
                    <span className="font-bold font-mono text-purple-300">
                      {selectedReceivingAsset.symbol} ({selectedReceivingAsset.networkLabel})
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Payout Wallet:</span>
                  {hasWallet ? (
                    <span className="font-mono text-cyan-300 font-bold">{shortenAddress(activeMerchantAddress, 5)}</span>
                  ) : (
                    <span className="text-amber-400 font-semibold flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      <span>Wallet Not Connected</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Actions: Copy Link & Test Customer Checkout */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  id="copy-merchant-qr-btn"
                  onClick={handleCopyQRLink}
                  className="py-2.5 px-3.5 rounded-xl font-bold text-xs border bg-slate-800 hover:bg-slate-700 text-white border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
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
                  id="test-checkout-btn"
                  onClick={() => {
                    if (merchantInvoices.length > 0) {
                      onOpenCustomerCheckoutWithInvoice(merchantInvoices[0].id);
                    } else if (hasSavedSetup) {
                      handleSaveProfile();
                    }
                  }}
                  className="py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-cyan-500/20 cursor-pointer"
                >
                  <span>Test Customer Checkout</span>
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="w-full py-12 px-6 rounded-3xl bg-slate-950/80 border border-dashed border-slate-800 flex flex-col items-center justify-center text-center my-2 space-y-3">
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-500 shadow-inner">
                <QrCode className="w-12 h-12" />
              </div>
              <div className="space-y-1 max-w-xs">
                <h4 className="text-sm font-bold text-slate-200">Merchant Setup Required</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Fill in your merchant details on the left and click{' '}
                  <span className="text-cyan-400 font-semibold">"Create Merchant Setup"</span> to generate your active PayFlux payment QR code.
                </p>
              </div>
              <div className="pt-2 text-[11px] text-slate-600 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                <span>Zero custodial fees • Direct wallet settlement</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
