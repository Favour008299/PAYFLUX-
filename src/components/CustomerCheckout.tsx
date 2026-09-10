import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Store,
  Wallet,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  QrCode,
  Copy,
  Receipt,
  Sparkles,
  Info,
  ChevronRight,
  DollarSign,
  Camera,
  ClipboardPaste,
  Check,
  Layers,
  ArrowUpRight,
  ArrowDownUp,
  ArrowLeft,
  Search,
  ScanLine,
  Upload,
  Loader2,
  ArrowRightLeft
} from 'lucide-react';
import { useSendTransaction, useWriteContract, usePublicClient, useSwitchChain, useAccount, useChainId } from 'wagmi';
import { useAppKit } from '../hooks/useAppKit';
import { parseUnits, parseEther, formatEther, formatUnits, getAddress, maxUint256, encodeFunctionData, decodeEventLog, parseAbiItem, parseAbi } from 'viem';
import confetti from 'canvas-confetti';

import {
  Token,
  WalletAccount,
  MerchantInvoice,
  CustomerPaymentReceipt,
  NetworkType,
  UserSettings,
} from '../types';
import { calculatePaymentQuote, getLiveTokenPrices } from '../services/livePricing';
import {
  getInvoiceById,
  updateInvoiceStatus,
  saveCustomerReceipt,
  createMerchantReceiptAndLedgerEntry,
  recordPaymentAttempt,
  recordPaymentFailure,
  getMerchantProfile,
  fetchMerchantProfile,
  saveMerchantProfile,
  subscribeToPaymentUpdates,
  subscribeToMerchantProfileUpdates
} from '../services/paymentStorage';
import { saveTransaction, isRealEVMHash } from '../services/historyStorage';
import { SharePayLinkCheckout } from './SharePayLinkCheckout';
import {
  PAYFLUX_PLATFORM_FEE_POL,
  PAYFLUX_PLATFORM_FEE_WEI,
  PAYFLUX_PLATFORM_FEE_DISPLAY,
  PAYFLUX_PLATFORM_FEE_USD,
  PAYFLUX_TREASURY_ADDRESS,
  SUPPORTED_FIAT_CURRENCIES,
  MerchantProfile
} from '../config/platform';
import {
  checkSufficientFeeBalance,
  verifyOnChainPlatformFee,
  transferPlatformFeeToRevenueWallet,
} from '../services/payfluxFeeService';
import {
  getAtomicRouterAddress,
  isAtomicRouterConfigured,
  isSwapRoutingSupported,
  encodeAtomicSwapNative,
  encodeAtomicSwapToken,
  encodeAtomicPayNative,
  encodeAtomicPayToken,
} from '../services/payfluxAtomicRouterService';
import {
  TOKEN_CONTRACTS,
  ERC20_TRANSFER_ABI,
  getExplorerTxUrl
} from '../services/contractConfig';
import { shortenAddress, formatCurrency, isValidEVMAddress } from '../utils/crypto';
import {
  safeGetAddress,
  getUnifiedSwapQuote,
  SwapRouteQuote,
  ZERO_ADDRESS,
  polygonRpcClient,
  ethereumRpcClient,
  ERC20_STANDARD_ABI,
} from '../services/sharedSwapEngine';
import {
  triggerMobileWalletPrompt,
  setupWalletReturnDetector,
  getConnectedWalletBrand,
  sendTransactionWithRetry,
  executeWalletTransaction,
  executeTokenApproval,
  safeFormatError,
  getActiveWalletProvider,
  scanForRecentUserTx,
} from '../services/walletSigningService';
import { TokenIcon } from './TokenIcon';
import { QRScannerModal } from './QRScannerModal';
import { ParsedQRPayment, parseQRPaymentData } from '../utils/qrParser';
import { decodeQRCodeFromImageFile } from '../utils/qrReader';
import { trackEvent } from '../services/analytics';
import { useTranslation } from '../i18n';

interface CustomerCheckoutProps {
  initialInvoiceId?: string | null;
  wallet: WalletAccount | null;
  tokens: Token[];
  settings: UserSettings;
  onOpenConnectModal: () => void;
  onPaymentSuccess?: (receipt: CustomerPaymentReceipt) => void;
  onNavigateToMerchantHub?: () => void;
  onDisconnectWallet?: () => void;
}

type CheckoutMode = 'select_mode' | 'merchant_checkout' | 'direct_address' | 'share_pay_link';

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

const MULTICALL3_ABI = parseAbi([
  'struct Call3Value { address target; bool allowFailure; uint256 value; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3Value(Call3Value[] calldata calls) external payable returns (Result[] memory returnData)'
]);

function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export const CustomerCheckout: React.FC<CustomerCheckoutProps> = ({
  initialInvoiceId,
  wallet,
  tokens,
  settings,
  onOpenConnectModal,
  onPaymentSuccess,
  onNavigateToMerchantHub,
}) => {
  const { t } = useTranslation();
  const { open } = useAppKit();
  const { address: wagmiAddress, isConnected: wagmiConnected, connector } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  // Active address resolution with persistent fallback to wallet prop (shared across Swap & Pay)
  const activeAddress = (wagmiAddress || (wallet?.address as `0x${string}`)) || undefined;
  const isWalletConnected = Boolean((wagmiConnected || Boolean(wallet?.address)) && activeAddress);

  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  // Mode: select_mode (initial 2 options) | merchant_checkout | direct_address | share_pay_link
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>(() => {
    if (initialInvoiceId) return 'merchant_checkout';
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      const isPayRoute = pathname === '/pay' || pathname.startsWith('/pay/');
      if (isPayRoute || params.has('token') || params.has('to')) {
        return 'share_pay_link';
      }
    }
    return 'select_mode';
  });

  // QR Scanner Modal State
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isDirectUploading, setIsDirectUploading] = useState(false);
  const [directUploadError, setDirectUploadError] = useState<string | null>(null);
  const directFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Manual Address Input State (Option B)
  const [manualAddressInput, setManualAddressInput] = useState<string>('');
  const [manualAddressError, setManualAddressError] = useState<string | null>(null);

  // Merchant & Product Details (Dynamic from QR or Invoice)
  const [merchantName, setMerchantName] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [priceAmount, setPriceAmount] = useState<string>('0');
  const [priceCurrency, setPriceCurrency] = useState<string>('USD');
  const [merchantReceivingAsset, setMerchantReceivingAsset] = useState<string>('VERSE');
  const [merchantAddress, setMerchantAddress] = useState<string>('');
  const [merchantNetwork, setMerchantNetwork] = useState<NetworkType>('polygon');
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(initialInvoiceId || null);

  // Direct Address Payment State (Option B)
  const [directAmount, setDirectAmount] = useState<string>('10');
  const [directCurrency, setDirectCurrency] = useState<string>('USD');

  // Customer Payment Token Selection
  const [selectedPayToken, setSelectedPayToken] = useState<string>('USDT');
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkType>('polygon');

  // Live Conversion Quote State
  const [tokenQuote, setTokenQuote] = useState<{
    tokenAmount: string;
    tokenPriceUsd: number;
    exchangeRateText: string;
    isAvailable: boolean;
  }>({
    tokenAmount: '0',
    tokenPriceUsd: 0,
    exchangeRateText: 'Calculating conversion...',
    isAvailable: false,
  });
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);

  // Active On-Chain Routing Quote for Conversion to Merchant Receiving Asset
  const [activeSwapRoute, setActiveSwapRoute] = useState<SwapRouteQuote | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);

  // Payment Execution Lifecycle: 'review' | 'submitting' | 'confirming' | 'completed' | 'failed'
  const [paymentStatus, setPaymentStatus] = useState<'review' | 'submitting' | 'confirming' | 'completed' | 'failed'>('review');
  const [submittingStepText, setSubmittingStepText] = useState<{ title: string; subtitle: string } | null>(null);
  const [txHash, setTxHash] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedReceipt, setCompletedReceipt] = useState<CustomerPaymentReceipt | null>(null);
  const [scanSuccessNotification, setScanSuccessNotification] = useState<string | null>(null);
  const [isCheckingOnChain, setIsCheckingOnChain] = useState<boolean>(false);

  const isSubmittingRef = React.useRef(false);
  const attemptIdRef = React.useRef<string>('');
  const activeAttemptDataRef = React.useRef<any>(null);

  // Available Tokens for Customer to Pay with on the selected network
  const availableCustomerTokens = tokens.filter((t) => t.network === selectedNetwork);
  const activePayTokenObj = tokens.find((t) => t.symbol === selectedPayToken && t.network === selectedNetwork) || tokens[0];

  // User balance for currently selected token
  const currentUserTokenBalance = useMemo(() => {
    if (!wallet) return activePayTokenObj?.balance ?? 0;
    const netKey = `${selectedNetwork.toLowerCase()}:${selectedPayToken.toUpperCase()}`;
    if (wallet.tokens && typeof (wallet.tokens as any)[netKey] === 'number') {
      return (wallet.tokens as any)[netKey];
    }
    const tokenItem = tokens.find(
      (t) => t.symbol === selectedPayToken && t.network === selectedNetwork
    );
    return tokenItem?.balance ?? activePayTokenObj?.balance ?? 0;
  }, [wallet, tokens, selectedPayToken, selectedNetwork, activePayTokenObj]);

  const requiredPayAmount = parseFloat(tokenQuote.tokenAmount) || 0;
  const isInsufficientBalance = isWalletConnected && requiredPayAmount > 0 && currentUserTokenBalance < requiredPayAmount;

  // Load initial invoice if provided via props
  useEffect(() => {
    if (initialInvoiceId) {
      const inv = getInvoiceById(initialInvoiceId);
      if (inv) {
        setMerchantName(inv.merchantName);
        setProductName(inv.productName);
        setPriceAmount(inv.fiatAmount.toString());
        setPriceCurrency(inv.fiatCurrency || 'USD');
        setMerchantReceivingAsset(inv.targetToken);
        setMerchantAddress(inv.merchantAddress);
        setMerchantNetwork(inv.network);
        setSelectedNetwork(inv.network);
        setActiveInvoiceId(inv.id);
        setCheckoutMode('merchant_checkout');
      }
    }
  }, [initialInvoiceId]);

  // Handle URL updates or back/forward navigation for share pay link (/pay?token=...&to=...)
  useEffect(() => {
    const handleUrlUpdate = () => {
      if (typeof window !== 'undefined' && !initialInvoiceId) {
        const pathname = window.location.pathname.toLowerCase();
        const params = new URLSearchParams(window.location.search);
        const isPayRoute = pathname === '/pay' || pathname.startsWith('/pay/');
        if (isPayRoute || params.has('token') || params.has('to')) {
          setCheckoutMode('share_pay_link');
        }
      }
    };
    window.addEventListener('popstate', handleUrlUpdate);
    return () => window.removeEventListener('popstate', handleUrlUpdate);
  }, [initialInvoiceId]);

  // Listen to live merchant profile updates
  useEffect(() => {
    if (!merchantAddress || !isValidEVMAddress(merchantAddress)) return;

    const unsubscribe = subscribeToMerchantProfileUpdates((addr) => {
      if (addr === '*' || addr.toLowerCase() === merchantAddress.toLowerCase()) {
        const latestProfile = getMerchantProfile(merchantAddress);
        if (latestProfile && checkoutMode === 'merchant_checkout') {
          setMerchantName(latestProfile.merchantName);
          setProductName(latestProfile.productName);
          setPriceAmount(latestProfile.priceAmount.toString());
          setPriceCurrency(latestProfile.currency);
          setMerchantReceivingAsset(latestProfile.receivingAsset);
          setMerchantNetwork(latestProfile.receivingNetwork);
          setSelectedNetwork(latestProfile.receivingNetwork);
        }
      }
    });

    return () => unsubscribe();
  }, [merchantAddress, checkoutMode]);

  // Handle QR Scan Success
  const handleQRScanSuccess = (result: ParsedQRPayment) => {
    setIsScannerOpen(false);

    if (result.address && isValidEVMAddress(result.address)) {
      const scannedAddr = result.address;
      setMerchantAddress(scannedAddr);

      // Check if the scanned QR code itself has explicit merchant details (like merchantName, productName, priceAmount, etc.)
      // The QR code contains the merchant's latest configuration and product invoice at the moment of QR generation.
      const hasExplicitQRDetails = Boolean(
        result.merchantName || result.productName || result.priceAmount !== undefined || result.fiatAmount !== undefined
      );

      if (hasExplicitQRDetails) {
        const resolvedName = result.merchantName || 'PayFlux Merchant';
        const resolvedProduct = result.productName || 'General Goods/Service';
        const rawAmt = result.priceAmount ?? result.fiatAmount ?? result.amount ?? 10;
        const resolvedCurrency = result.fiatCurrency || 'USD';
        const resolvedAsset = result.receivingAsset || result.token || 'USDT';
        const numAmt = typeof rawAmt === 'number' ? rawAmt : parseFloat(String(rawAmt)) || 10;
        const resolvedNetwork: 'polygon' | 'ethereum' = (result.network || '').toLowerCase().includes('eth') ? 'ethereum' : 'polygon';

        setMerchantName(resolvedName);
        setProductName(resolvedProduct);
        setPriceAmount(numAmt.toString());
        setPriceCurrency(resolvedCurrency);
        setMerchantReceivingAsset(resolvedAsset);
        setMerchantNetwork(resolvedNetwork);
        setSelectedNetwork(resolvedNetwork);

        // Update the local & cloud merchant profile registry so this address is remembered with its latest status
        saveMerchantProfile({
          merchantName: resolvedName,
          productName: resolvedProduct,
          priceAmount: numAmt,
          currency: resolvedCurrency,
          receivingAsset: resolvedAsset,
          receivingNetwork: resolvedNetwork,
          walletAddress: scannedAddr,
          updatedAt: Date.now(),
        });

        setScanSuccessNotification(`Loaded Merchant: ${resolvedName}`);
      } else {
        // The QR code was a plain wallet address (e.g. 0x5545d...).
        // Look up the merchant's latest profile dynamically from local cache or Firestore
        const dynamicProfile = getMerchantProfile(scannedAddr);
        if (dynamicProfile) {
          setMerchantName(dynamicProfile.merchantName);
          setProductName(dynamicProfile.productName);
          setPriceAmount(dynamicProfile.priceAmount.toString());
          setPriceCurrency(dynamicProfile.currency);
          setMerchantReceivingAsset(dynamicProfile.receivingAsset);
          setMerchantNetwork(dynamicProfile.receivingNetwork);
          setSelectedNetwork(dynamicProfile.receivingNetwork);
          setScanSuccessNotification(`Loaded Live Merchant: ${dynamicProfile.merchantName}`);
        } else {
          setMerchantName('PayFlux Merchant');
          setProductName('General Payment');
          setPriceAmount('10');
          setPriceCurrency('USD');
          setMerchantReceivingAsset('VERSE');
          setMerchantNetwork('polygon');
          setSelectedNetwork('polygon');
          setScanSuccessNotification(`Scanned Recipient: ${shortenAddress(scannedAddr, 5)}`);
        }

        // Also asynchronously try to fetch fresh from Firestore in case it was updated on another device
        fetchMerchantProfile(scannedAddr).then((cloudProfile) => {
          if (cloudProfile) {
            setMerchantName(cloudProfile.merchantName);
            setProductName(cloudProfile.productName);
            setPriceAmount(cloudProfile.priceAmount.toString());
            setPriceCurrency(cloudProfile.currency);
            setMerchantReceivingAsset(cloudProfile.receivingAsset);
            setMerchantNetwork(cloudProfile.receivingNetwork);
            setSelectedNetwork(cloudProfile.receivingNetwork);
          }
        });
      }

      setActiveInvoiceId(result.invoiceId || null);
      setCheckoutMode('merchant_checkout');
      setPaymentStatus('review');
      setErrorMessage(null);
      setTimeout(() => setScanSuccessNotification(null), 4000);
    } else if (result.invoiceId) {
      const inv = getInvoiceById(result.invoiceId);
      if (inv) {
        setMerchantName(inv.merchantName);
        setProductName(inv.productName);
        setPriceAmount(inv.fiatAmount.toString());
        setPriceCurrency(inv.fiatCurrency || 'USD');
        setMerchantReceivingAsset(inv.targetToken);
        setMerchantAddress(inv.merchantAddress);
        setMerchantNetwork(inv.network);
        setSelectedNetwork(inv.network);
        setActiveInvoiceId(inv.id);
        setCheckoutMode('merchant_checkout');
        setPaymentStatus('review');
        setScanSuccessNotification(`Loaded Invoice: ${inv.productName}`);
        setTimeout(() => setScanSuccessNotification(null), 4000);
      }
    } else {
      setErrorMessage('Could not find a valid merchant recipient in the scanned QR code.');
    }
  };

  // Handle direct image file upload from main view
  const handleDirectImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDirectUploadError(null);
    setIsDirectUploading(true);

    try {
      const result = await decodeQRCodeFromImageFile(file);
      if (result.success && result.parsed) {
        handleQRScanSuccess(result.parsed);
      } else {
        setDirectUploadError(result.error || 'Could not find a valid payment QR code in this image.');
      }
    } catch (err: unknown) {
      console.error('Direct upload QR failure:', err);
      setDirectUploadError('Failed to read image file. Please upload a clear PNG, JPEG, or WebP image.');
    } finally {
      setIsDirectUploading(false);
      if (directFileInputRef.current) {
        directFileInputRef.current.value = '';
      }
    }
  };

  // Handle Option B: Proceed with Pasted Merchant Address
  const handleProceedWithManualAddress = () => {
    const cleaned = manualAddressInput.trim();
    if (!cleaned) {
      setManualAddressError('Please enter an EVM wallet or payment address.');
      return;
    }
    if (!isValidEVMAddress(cleaned)) {
      setManualAddressError('Invalid Ethereum/Polygon address format. Must be 0x followed by 40 hex characters.');
      return;
    }

    setManualAddressError(null);
    setMerchantAddress(cleaned);

    // Check if this address has an existing merchant profile in local storage
    const profile = getMerchantProfile(cleaned);
    if (profile) {
      setMerchantName(profile.merchantName);
      setProductName(profile.productName);
      setPriceAmount(profile.priceAmount.toString());
      setPriceCurrency(profile.currency);
      setMerchantReceivingAsset(profile.receivingAsset);
      setMerchantNetwork(profile.receivingNetwork);
      setSelectedNetwork(profile.receivingNetwork);
      setCheckoutMode('merchant_checkout');
    } else {
      setCheckoutMode('direct_address');
    }
    setPaymentStatus('review');

    // Also asynchronously fetch from Firestore in case the merchant updated recently
    fetchMerchantProfile(cleaned).then((cloudProfile) => {
      if (cloudProfile) {
        setMerchantName(cloudProfile.merchantName);
        setProductName(cloudProfile.productName);
        setPriceAmount(cloudProfile.priceAmount.toString());
        setPriceCurrency(cloudProfile.currency);
        setMerchantReceivingAsset(cloudProfile.receivingAsset);
        setMerchantNetwork(cloudProfile.receivingNetwork);
        setSelectedNetwork(cloudProfile.receivingNetwork);
        setCheckoutMode('merchant_checkout');
      }
    });
  };

  // Reset back to initial 2-option selection screen
  const handleResetToModeSelect = () => {
    setCheckoutMode('select_mode');
    setPaymentStatus('review');
    setCompletedReceipt(null);
    setErrorMessage(null);
    setMerchantAddress('');
    setMerchantName('');
    setProductName('');
    setPriceAmount('0');
    setActiveInvoiceId(null);
    setManualAddressInput('');
    setManualAddressError(null);

    // Clean URL params without reload
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  // Live Conversion Calculation for Merchant Checkout or Direct Address Flow
  const currentFiatCurrency = checkoutMode === 'merchant_checkout' ? priceCurrency : directCurrency;
  const currentFiatAmountStr = checkoutMode === 'merchant_checkout' ? priceAmount : directAmount;
  const fiatInfo = SUPPORTED_FIAT_CURRENCIES[currentFiatCurrency] || SUPPORTED_FIAT_CURRENCIES.USD;
  const numPrice = parseFloat(currentFiatAmountStr) || 0;
  const basePriceUsd = currentFiatCurrency === 'USD' ? numPrice : numPrice / (fiatInfo.rate || 1);
  const totalDueUsdWithFee = basePriceUsd;

  // Respect merchant-selected payout asset: convert payment token to merchant receiving asset when different
  const isConversionNeeded =
    checkoutMode === 'merchant_checkout' &&
    Boolean(merchantReceivingAsset) &&
    (selectedPayToken !== merchantReceivingAsset || selectedNetwork !== merchantNetwork);

  useEffect(() => {
    let isMounted = true;

    async function updateConversion() {
      if (basePriceUsd <= 0 || checkoutMode === 'select_mode') {
        setTokenQuote({
          tokenAmount: '0',
          tokenPriceUsd: 0,
          exchangeRateText: 'Enter an amount to calculate quote',
          isAvailable: false,
        });
        setActiveSwapRoute(null);
        setRouteError(null);
        return;
      }

      setIsLoadingQuote(true);
      if (isConversionNeeded) {
        setIsLoadingRoute(true);
      }

      try {
        const quote = await calculatePaymentQuote({
          amountDueUsd: basePriceUsd,
          payTokenSymbol: selectedPayToken,
        });

        if (!isMounted) return;
        setTokenQuote(quote);

        if (isConversionNeeded && merchantAddress && isValidEVMAddress(merchantAddress)) {
          const srcChainId = selectedNetwork === 'ethereum' ? 1 : 137;
          const dstChainId = merchantNetwork === 'ethereum' ? 1 : 137;

          const srcNetContracts = TOKEN_CONTRACTS[srcChainId];
          const dstNetContracts = TOKEN_CONTRACTS[dstChainId];

          const srcTokenInfo = srcNetContracts ? srcNetContracts[selectedPayToken] : null;
          const dstTokenInfo = dstNetContracts ? dstNetContracts[merchantReceivingAsset] : null;

          if (!srcTokenInfo || !dstTokenInfo) {
            if (isMounted) {
              setActiveSwapRoute(null);
              setRouteError(`Routing configuration missing for ${selectedPayToken} or ${merchantReceivingAsset}.`);
            }
            return;
          }

          const swapQuote = await getUnifiedSwapQuote({
            srcChainId,
            srcTokenAddress: srcTokenInfo.isNative ? ZERO_ADDRESS : srcTokenInfo.address,
            srcDecimals: srcTokenInfo.decimals || 18,
            srcSymbol: selectedPayToken,
            srcAmount: quote.tokenAmount,
            dstChainId,
            dstTokenAddress: dstTokenInfo.isNative ? ZERO_ADDRESS : dstTokenInfo.address,
            dstDecimals: dstTokenInfo.decimals || 18,
            dstSymbol: merchantReceivingAsset,
            userAddress: activeAddress || undefined,
            recipientAddress: merchantAddress,
            slippagePercent: 0.5,
          });

          if (isMounted) {
            if (swapQuote.success && parseFloat(swapQuote.formattedAmountOut) > 0) {
              setActiveSwapRoute(swapQuote);
              setRouteError(null);
            } else {
              setActiveSwapRoute(null);
              setRouteError(
                swapQuote.errorMessage ||
                `Payment cannot be completed — no valid on-chain route found to convert ${selectedPayToken} into merchant's ${merchantReceivingAsset}. Please select a different payment token.`
              );
            }
          }
        } else {
          if (isMounted) {
            setActiveSwapRoute(null);
            setRouteError(null);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setTokenQuote({
            tokenAmount: '0',
            tokenPriceUsd: 0,
            exchangeRateText: 'Selected payment route is currently unavailable.',
            isAvailable: false,
          });
          setActiveSwapRoute(null);
          setRouteError('Selected payment route is currently unavailable.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingQuote(false);
          setIsLoadingRoute(false);
        }
      }
    }

    updateConversion();
    const interval = setInterval(updateConversion, 12000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [
    basePriceUsd,
    totalDueUsdWithFee,
    selectedPayToken,
    selectedNetwork,
    merchantReceivingAsset,
    merchantNetwork,
    merchantAddress,
    checkoutMode,
    isConversionNeeded,
    activeAddress,
  ]);

  // Finalize payment upon verified on-chain success
  const finalizeSuccessfulPayment = useCallback(async (params: {
    txHash: string;
    receipt?: any;
    overrideAttemptData?: any;
  }) => {
    const { txHash: confirmedHash, receipt: existingReceipt, overrideAttemptData } = params;
    if (!confirmedHash || !isRealEVMHash(confirmedHash)) return;

    const targetRpcClient = selectedNetwork === 'ethereum' ? ethereumRpcClient : polygonRpcClient;
    const targetChainId = selectedNetwork === 'ethereum' ? 1 : 137;
    let receipt = existingReceipt;
    if (!receipt) {
      try {
        receipt = await targetRpcClient.getTransactionReceipt({ hash: confirmedHash as `0x${string}` });
      } catch (e) {
        console.warn('[CustomerCheckout] Could not fetch receipt for finalization:', e);
      }
    }

    if (!receipt || (receipt.status !== 'success' && (receipt as any).status !== 1 && (receipt as any).status !== '0x1')) {
      console.warn('[CustomerCheckout] Transaction receipt is not confirmed successful:', receipt?.status);
      return;
    }

    const attemptData = overrideAttemptData || activeAttemptDataRef.current;
    const payer = activeAddress || attemptData?.activeAddress || (receipt?.from);
    const targetAttemptId = attemptIdRef.current || attemptData?.attemptId || `pay_${Date.now()}`;
    const targetMerchantAddr = merchantAddress || attemptData?.merchantAddress;
    const formattedMerchant = safeGetAddress(targetMerchantAddr);
    const resolvedMerchantName = merchantName || attemptData?.merchantName || (checkoutMode === 'direct_address' ? 'Direct Wallet Recipient' : 'PayFlux Merchant');
    const resolvedProductName = productName || attemptData?.productName || (checkoutMode === 'direct_address' ? 'Direct Address Payment' : 'Goods & Services');

    const parsedPayAmount = parseFloat(tokenQuote.tokenAmount);
    const resolvedAmountPaid = (parsedPayAmount > 0 ? parsedPayAmount : (attemptData?.payAmountNum || 0)).toFixed(4);
    const resolvedToken = selectedPayToken || attemptData?.selectedPayToken || 'USDT';
    const resolvedFiatAmount = numPrice || attemptData?.numPrice || 0;
    const resolvedFiatCurrency = currentFiatCurrency || attemptData?.currentFiatCurrency || 'USD';
    const resolvedBasePriceUsd = basePriceUsd || attemptData?.basePriceUsd || 0;
    const resolvedRouting = attemptData?.routingUsed || (isConversionNeeded ? 'QuickSwap DEX' : 'PayFlux Direct Transfer');

    // Extract actual merchant received amount:
    // If output is POL, scan receipt logs for WPOL withdrawal: 0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65
    let resolvedMerchantReceivedAmount = attemptData?.finalMerchantReceivedAmount;
    if (!resolvedMerchantReceivedAmount && receipt && receipt.logs) {
      for (const log of receipt.logs) {
        if (
          log.address &&
          log.address.toLowerCase() === '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270' &&
          log.topics &&
          log.topics[0] === '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'
        ) {
          try {
            const amountWei = BigInt(log.data);
            resolvedMerchantReceivedAmount = (Number(amountWei) / 1e18).toFixed(6);
          } catch (_) {}
        }
      }
    }
    if (!resolvedMerchantReceivedAmount) {
      resolvedMerchantReceivedAmount = (resolvedBasePriceUsd / (tokenQuote.tokenPriceUsd || 1)).toFixed(4);
    }
    const resolvedMerchantReceivedAsset = attemptData?.finalMerchantReceivedAsset || merchantReceivingAsset || 'POL';

    // Verify on-chain platform fee
    const feeVerification = await verifyOnChainPlatformFee({
      receipt,
      txHash: confirmedHash as `0x${string}`,
      targetChainId,
      walletAddress: payer,
    });

    const isFeeConfirmed = feeVerification.isVerified;
    const feeStatusVal = isFeeConfirmed ? ('confirmed' as const) : ('uncollected' as const);
    const feePolVal = isFeeConfirmed ? PAYFLUX_PLATFORM_FEE_POL : 0;
    const feeDisplayVal = isFeeConfirmed ? PAYFLUX_PLATFORM_FEE_DISPLAY : '0 POL (Bypassed via DEX direct route)';

    const completedReceiptObj: CustomerPaymentReceipt = {
      id: targetAttemptId,
      invoiceId: activeInvoiceId || attemptData?.activeInvoiceId || undefined,
      merchantName: resolvedMerchantName,
      merchantAddress: formattedMerchant,
      productName: resolvedProductName,
      payerAddress: payer,
      amountPaid: resolvedAmountPaid,
      tokenSymbol: resolvedToken,
      merchantReceivedAmount: resolvedMerchantReceivedAmount,
      merchantReceivedAsset: resolvedMerchantReceivedAsset,
      routingProtocol: resolvedRouting,
      isConverted: isConversionNeeded || Boolean(attemptData?.isConversionNeeded),
      fiatValueUsd: resolvedBasePriceUsd,
      fiatAmount: resolvedFiatAmount,
      fiatCurrency: resolvedFiatCurrency,
      payfluxFeePol: feePolVal,
      payfluxFeeDisplay: feeDisplayVal,
      payfluxFeeUsd: isFeeConfirmed ? 0.10 : 0,
      feeToken: 'POL',
      feeAmountToken: isFeeConfirmed ? '0.1' : '0',
      feeNetwork: 'Polygon',
      feeStatus: feeStatusVal,
      feeTxHash: isFeeConfirmed ? confirmedHash : undefined,
      feeRecipient: PAYFLUX_TREASURY_ADDRESS,
      txHash: confirmedHash,
      network: selectedNetwork,
      chainId: targetChainId,
      timestamp: Date.now(),
      status: 'completed',
      networkFeeUsd: 0.005,
      explorerUrl: getExplorerTxUrl(selectedNetwork, confirmedHash),
    };

    saveCustomerReceipt(completedReceiptObj);

    createMerchantReceiptAndLedgerEntry({
      customerReceipt: completedReceiptObj,
      txHash: confirmedHash,
      receipt,
    });

    saveTransaction({
      id: `pay_${targetAttemptId}`,
      hash: confirmedHash,
      type: 'payment',
      tokenSymbol: resolvedToken,
      amount: resolvedAmountPaid,
      merchantName: completedReceiptObj.merchantName,
      productName: completedReceiptObj.productName,
      recipientAddress: formattedMerchant,
      senderAddress: payer,
      userAddress: payer,
      payerAddress: payer,
      walletAddress: payer,
      merchantReceivedAmount: resolvedMerchantReceivedAmount,
      merchantReceivedAsset: resolvedMerchantReceivedAsset,
      timestamp: Date.now(),
      status: 'completed',
      networkFeeUsd: 0.005,
      payfluxFeeUsd: isFeeConfirmed ? 0.10 : 0,
      payfluxFeePol: feePolVal,
      payfluxFeeDisplay: feeDisplayVal,
      feeStatus: feeStatusVal,
      feeTxHash: isFeeConfirmed ? confirmedHash : undefined,
      feeRecipient: PAYFLUX_TREASURY_ADDRESS,
      blockNumber: receipt?.blockNumber ? Number(receipt.blockNumber) : undefined,
      explorerUrl: getExplorerTxUrl(selectedNetwork, confirmedHash),
      network: selectedNetwork,
    });

    if (activeInvoiceId || attemptData?.activeInvoiceId) {
      const invId = activeInvoiceId || attemptData?.activeInvoiceId;
      updateInvoiceStatus(invId, {
        status: 'paid',
        paidTxHash: confirmedHash,
        payerAddress: payer,
        paidToken: resolvedToken,
        paidAmount: resolvedAmountPaid,
        paidTimestamp: Date.now(),
        payfluxFeePol: feePolVal,
        payfluxFeeDisplay: feeDisplayVal,
        payfluxFeeUsd: isFeeConfirmed ? 0.10 : 0,
        feeStatus: feeStatusVal,
        feeTxHash: isFeeConfirmed ? confirmedHash : undefined,
      });
    }

    setCompletedReceipt(completedReceiptObj);
    setTxHash(confirmedHash);
    setPaymentStatus('completed');
    isSubmittingRef.current = false;
    setSubmittingStepText(null);

    try {
      sessionStorage.removeItem('payflux_active_checkout_attempt');
    } catch (_) {}

    try {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
      });
    } catch (_) {}

    if (onPaymentSuccess) {
      onPaymentSuccess(completedReceiptObj);
    }
  }, [
    activeAddress,
    merchantAddress,
    merchantName,
    checkoutMode,
    productName,
    selectedPayToken,
    numPrice,
    currentFiatCurrency,
    basePriceUsd,
    isConversionNeeded,
    merchantReceivingAsset,
    selectedNetwork,
    activeInvoiceId,
    tokenQuote.tokenAmount,
    tokenQuote.tokenPriceUsd,
    onPaymentSuccess,
  ]);

  // Active on-chain verification handler for user returns or explicit button clicks
  const handleCheckOnChainStatus = useCallback(async () => {
    if (!activeAddress || isCheckingOnChain) return;
    setIsCheckingOnChain(true);
    const targetRpcClient = selectedNetwork === 'ethereum' ? ethereumRpcClient : polygonRpcClient;
    console.log('[CustomerCheckout] Checking on-chain status for active payment (txHash:', txHash, 'status:', paymentStatus, ')...');

    try {
      // 1. If txHash is already known, query receipt directly
      if (txHash && isRealEVMHash(txHash)) {
        const receipt = await targetRpcClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
        if (receipt) {
          if (receipt.status === 'success' || (receipt as any).status === 1 || (receipt as any).status === '0x1') {
            console.log('[CustomerCheckout] Verified successful receipt on-chain:', txHash);
            await finalizeSuccessfulPayment({ txHash, receipt });
            setIsCheckingOnChain(false);
            return;
          } else if (receipt.status === 'reverted' || (receipt as any).status === 0) {
            setErrorMessage(`Payment transaction reverted on blockchain (Tx: ${txHash}). View on explorer: ${getExplorerTxUrl(selectedNetwork, txHash)}`);
            setPaymentStatus('failed');
            setIsCheckingOnChain(false);
            return;
          }
        }
      }

      // 2. Scan recent blocks for transactions from activeAddress
      const userAddr = safeGetAddress(activeAddress);
      const scannedHash = await scanForRecentUserTx(targetRpcClient, userAddr, undefined, 35);
      if (scannedHash) {
        console.log('[CustomerCheckout] Found on-chain transaction for user:', scannedHash);
        setTxHash(scannedHash);
        const receipt = await targetRpcClient.getTransactionReceipt({ hash: scannedHash });
        if (receipt && (receipt.status === 'success' || (receipt as any).status === 1 || (receipt as any).status === '0x1')) {
          await finalizeSuccessfulPayment({ txHash: scannedHash, receipt });
          setIsCheckingOnChain(false);
          return;
        } else if (receipt && (receipt.status === 'reverted' || (receipt as any).status === 0)) {
          setErrorMessage(`Payment transaction reverted on blockchain (Tx: ${scannedHash}). View on explorer: ${getExplorerTxUrl(selectedNetwork, scannedHash)}`);
          setPaymentStatus('failed');
          setIsCheckingOnChain(false);
          return;
        } else {
          setPaymentStatus('confirming');
        }
      }
    } catch (checkErr) {
      console.warn('[CustomerCheckout] On-chain check notice:', checkErr);
    } finally {
      setIsCheckingOnChain(false);
    }
  }, [activeAddress, isCheckingOnChain, selectedNetwork, txHash, paymentStatus, finalizeSuccessfulPayment]);

  // Return detector: when user returns from Bitcoin.com Wallet app back to browser tab
  useEffect(() => {
    if (paymentStatus !== 'submitting' && paymentStatus !== 'confirming') return;

    const cleanup = setupWalletReturnDetector(async () => {
      console.log('[CustomerCheckout] User returned from wallet app. Triggering on-chain status check...');
      handleCheckOnChainStatus();
    });

    return () => cleanup();
  }, [paymentStatus, handleCheckOnChainStatus]);

  // Auto-recovery of recently submitted attempt on mount
  useEffect(() => {
    try {
      const savedAttempt = sessionStorage.getItem('payflux_active_checkout_attempt');
      if (savedAttempt) {
        const data = JSON.parse(savedAttempt);
        if (data && data.startTime && Date.now() - data.startTime < 900000) {
          activeAttemptDataRef.current = data;
          if (data.attemptId) attemptIdRef.current = data.attemptId;
          if (data.txHash && isRealEVMHash(data.txHash)) {
            setTxHash(data.txHash);
            const rpc = data.selectedNetwork === 'ethereum' ? ethereumRpcClient : polygonRpcClient;
            rpc.getTransactionReceipt({ hash: data.txHash as `0x${string}` })
              .then((rcpt) => {
                if (rcpt && (rcpt.status === 'success' || (rcpt as any).status === 1 || (rcpt as any).status === '0x1')) {
                  finalizeSuccessfulPayment({ txHash: data.txHash, receipt: rcpt, overrideAttemptData: data });
                }
              })
              .catch(() => {});
          }
        }
      }
    } catch (_) {}
  }, [finalizeSuccessfulPayment]);

  // Execute Real On-Chain Payment
  const handleExecutePayment = async () => {
    if (isSubmittingRef.current || paymentStatus === 'submitting' || paymentStatus === 'confirming') {
      return;
    }

    if (!isWalletConnected || !activeAddress) {
      onOpenConnectModal();
      return;
    }

    if (!merchantAddress || !isValidEVMAddress(merchantAddress)) {
      setErrorMessage('Please provide a valid merchant EVM recipient address.');
      setPaymentStatus('failed');
      return;
    }

    if (isLoadingQuote || isLoadingRoute) {
      setErrorMessage('Calculating DEX Route & Payout Quote... Please wait for calculations to complete before paying.');
      setPaymentStatus('failed');
      return;
    }

    const payAmountNum = parseFloat(tokenQuote.tokenAmount);
    if (isNaN(payAmountNum) || payAmountNum <= 0 || !tokenQuote.isAvailable) {
      setErrorMessage('Invalid payment amount. Please wait for the quote to load.');
      setPaymentStatus('failed');
      return;
    }

    if (isConversionNeeded && (!activeSwapRoute || !activeSwapRoute.success || !activeSwapRoute.transactionData)) {
      setErrorMessage(
        routeError ||
        `Payment route unavailable: No valid on-chain DEX route found to convert ${selectedPayToken} into ${merchantReceivingAsset}. Please choose a supported payment token.`
      );
      setPaymentStatus('failed');
      return;
    }

    isSubmittingRef.current = true;
    setPaymentStatus('submitting');
    setSubmittingStepText(null);
    setErrorMessage(null);

    const attemptId = recordPaymentAttempt({
      invoiceId: activeInvoiceId || undefined,
      merchantName: merchantName || (checkoutMode === 'direct_address' ? 'Direct Wallet Recipient' : 'PayFlux Merchant'),
      merchantAddress: merchantAddress,
      productName: productName || (checkoutMode === 'direct_address' ? 'Direct Address Payment' : 'Goods & Services'),
      payerAddress: activeAddress,
      amountPaid: payAmountNum.toFixed(4),
      tokenSymbol: selectedPayToken,
      fiatValueUsd: totalDueUsdWithFee,
      fiatAmount: numPrice,
      fiatCurrency: currentFiatCurrency,
      network: selectedNetwork,
      chainId: selectedNetwork === 'ethereum' ? 1 : 137,
    });

    attemptIdRef.current = attemptId;
    const initialAttemptData = {
      attemptId,
      activeInvoiceId: activeInvoiceId || undefined,
      merchantName: merchantName || (checkoutMode === 'direct_address' ? 'Direct Wallet Recipient' : 'PayFlux Merchant'),
      merchantAddress: merchantAddress,
      productName: productName || (checkoutMode === 'direct_address' ? 'Direct Address Payment' : 'Goods & Services'),
      activeAddress,
      selectedPayToken,
      payAmountNum,
      numPrice,
      currentFiatCurrency,
      basePriceUsd,
      isConversionNeeded,
      merchantReceivingAsset,
      selectedNetwork,
      targetChainId: selectedNetwork === 'ethereum' ? 1 : 137,
      startTime: Date.now(),
    };
    activeAttemptDataRef.current = initialAttemptData;
    try {
      sessionStorage.setItem('payflux_active_checkout_attempt', JSON.stringify(initialAttemptData));
    } catch (_) {}

    let submittedTxHash: string | undefined = undefined;

    try {
      const isNative =
        (selectedNetwork === 'polygon' && selectedPayToken === 'POL') ||
        (selectedNetwork === 'ethereum' && selectedPayToken === 'ETH');

      const isMerchantNative =
        (merchantNetwork === 'polygon' && merchantReceivingAsset === 'POL') ||
        (merchantNetwork === 'ethereum' && merchantReceivingAsset === 'ETH');

      const targetChainId = selectedNetwork === 'ethereum' ? 1 : 137;
      const targetRpcClient = selectedNetwork === 'ethereum' ? ethereumRpcClient : polygonRpcClient;
      const formattedMerchant = safeGetAddress(merchantAddress);

      // STEP 0: Check Sufficient POL Fee Balance (0.1 POL + Gas) on Polygon
      const feeCheck = await checkSufficientFeeBalance({
        userAddress: activeAddress,
        fromTokenSymbol: selectedPayToken,
        fromAmount: payAmountNum.toString(),
        userPolBalance: selectedNetwork === 'polygon' && selectedPayToken === 'POL' ? currentUserTokenBalance : undefined,
      });

      if (!feeCheck.isSufficient) {
        const errorDetail = feeCheck.errorMessage || 'Insufficient POL balance for PayFlux 0.1 POL platform fee. Please ensure you have at least 0.108 POL on Polygon.';
        setErrorMessage(`Payment Stopped: ${errorDetail} No merchant payment was sent.`);
        setPaymentStatus('failed');
        recordPaymentFailure(attemptId, errorDetail);
        isSubmittingRef.current = false;
        return;
      }

      // STEP 1: Strict Real On-Chain Balance Check Before Submitting
      let onChainBalanceRaw = 0n;
      let userOnChainFormatted = currentUserTokenBalance;

      if (isNative) {
        const requiredWei = parseEther(payAmountNum.toFixed(6));
        try {
          onChainBalanceRaw = await targetRpcClient.getBalance({
            address: safeGetAddress(activeAddress),
          });
          userOnChainFormatted = parseFloat(formatEther(onChainBalanceRaw));
        } catch (readErr) {
          console.warn('Could not read native on-chain balance via targetRpcClient:', readErr);
          onChainBalanceRaw = parseEther(currentUserTokenBalance.toFixed(6));
        }

        if (onChainBalanceRaw < requiredWei) {
          const err = `Insufficient ${selectedPayToken} balance. Your wallet has ${userOnChainFormatted.toFixed(4)} ${selectedPayToken}, but this payment requires ${payAmountNum.toFixed(4)} ${selectedPayToken}.`;
          setErrorMessage(err);
          setPaymentStatus('failed');
          return;
        }
      } else {
        const netContracts = TOKEN_CONTRACTS[targetChainId];
        const tokenInfo = netContracts ? netContracts[selectedPayToken] : null;
        const tokenContractAddr = tokenInfo?.address;

        if (!tokenContractAddr || tokenInfo?.isNative) {
          throw new Error(`Token contract for ${selectedPayToken} on ${selectedNetwork} is not configured.`);
        }

        const decimals = tokenInfo.decimals || activePayTokenObj.decimals || (selectedPayToken === 'USDT' || selectedPayToken === 'USDC' ? 6 : 18);
        const parsedAmount = parseUnits(payAmountNum.toFixed(decimals > 6 ? 6 : decimals), decimals);

        try {
          onChainBalanceRaw = (await (targetRpcClient as any).readContract({
            address: safeGetAddress(tokenContractAddr),
            abi: ERC20_STANDARD_ABI,
            functionName: 'balanceOf',
            args: [safeGetAddress(activeAddress)],
          })) as bigint;
          userOnChainFormatted = parseFloat(formatUnits(onChainBalanceRaw, decimals));
        } catch (readErr) {
          console.warn('Could not read ERC20 on-chain balance via targetRpcClient:', readErr);
          userOnChainFormatted = currentUserTokenBalance;
          onChainBalanceRaw = parseUnits(currentUserTokenBalance.toString(), decimals);
        }

        if (onChainBalanceRaw < parsedAmount) {
          const err = `Insufficient ${selectedPayToken} balance. Your wallet has ${userOnChainFormatted.toFixed(4)} ${selectedPayToken}, but this payment requires ${payAmountNum.toFixed(4)} ${selectedPayToken}.`;
          setErrorMessage(err);
          setPaymentStatus('failed');
          return;
        }
      }

      // STEP 2: Network Verification and Auto Chain Switching
      if (chainId && chainId !== targetChainId && switchChainAsync) {
        try {
          await switchChainAsync({ chainId: targetChainId });
        } catch (switchErr: any) {
          console.warn('Chain switch notice:', switchErr);
          if (switchErr?.message?.includes('User rejected') || switchErr?.message?.includes('denied')) {
            throw new Error(`Please switch your wallet network to ${selectedNetwork === 'ethereum' ? 'Ethereum Mainnet' : 'Polygon'} (Chain ID: ${targetChainId}) to proceed.`);
          }
        }
      }

      // STEP 3: Route Execution or Direct Payment to Merchant (ONE User Confirmation in Connected Wallet)
      const validPayer = safeGetAddress(activeAddress);
      let hash = '';
      let routingUsed: string | undefined = undefined;
      let finalMerchantReceivedAmount = payAmountNum.toFixed(4);
      let finalMerchantReceivedAsset = selectedPayToken;

      // Snapshot PayFlux revenue wallet balance prior to execution for balance delta verification
      let revenueBalBefore: bigint | null = null;
      if (targetChainId === 137) {
        try {
          revenueBalBefore = await polygonRpcClient.getBalance({
            address: safeGetAddress(PAYFLUX_TREASURY_ADDRESS),
          });
        } catch (balErr) {
          console.warn('[CustomerCheckout] Could not snapshot treasury balance:', balErr);
        }
      }

      if (isConversionNeeded) {
        // Resolve fresh, up-to-the-second executable route with recipient set to formattedMerchant
        const merchantChainId = merchantNetwork === 'ethereum' ? 1 : 137;
        const netContracts = TOKEN_CONTRACTS[targetChainId];
        const dstNetContracts = TOKEN_CONTRACTS[merchantChainId];
        const srcTokenInfo = netContracts ? netContracts[selectedPayToken] : null;
        const dstTokenInfo = dstNetContracts ? dstNetContracts[merchantReceivingAsset] : null;

        const srcTokenAddr = isNative ? ZERO_ADDRESS : safeGetAddress(srcTokenInfo?.address);
        const dstTokenAddr = isMerchantNative ? ZERO_ADDRESS : safeGetAddress(dstTokenInfo?.address);

        let execRoute = activeSwapRoute;
        try {
          const freshExecutionRoute = await getUnifiedSwapQuote({
            srcChainId: targetChainId,
            srcTokenAddress: srcTokenAddr,
            srcDecimals: srcTokenInfo?.decimals || activePayTokenObj.decimals || (isNative ? 18 : 6),
            srcSymbol: selectedPayToken,
            srcAmount: payAmountNum.toString(),
            dstChainId: merchantChainId,
            dstTokenAddress: dstTokenAddr,
            dstDecimals: dstTokenInfo?.decimals || (merchantReceivingAsset === 'USDT' || merchantReceivingAsset === 'USDC' ? 6 : 18),
            dstSymbol: merchantReceivingAsset,
            userAddress: safeGetAddress(activeAddress),
            recipientAddress: formattedMerchant,
            slippagePercent: 1.5,
          });

          if (freshExecutionRoute.success && freshExecutionRoute.transactionData && freshExecutionRoute.transactionTo) {
            execRoute = freshExecutionRoute;
          }
        } catch (freshErr) {
          console.warn('[CustomerCheckout] Fresh route resolution notice, falling back to cached route:', freshErr);
        }

        if (!execRoute || !execRoute.success || !execRoute.transactionData || !execRoute.transactionTo) {
          throw new Error(
            routeError ||
            `Payment cannot be completed: No valid on-chain route exists to convert ${selectedPayToken} into ${merchantReceivingAsset}. Please select a supported payment token.`
          );
        }

        const expectedOut = parseFloat(execRoute.formattedAmountOut || execRoute.amountOut || '0');
        if (expectedOut <= 0) {
          throw new Error(`Invalid swap output: ${execRoute.routingProtocol || 'QuickSwap'} route returned 0 ${merchantReceivingAsset}. Transaction cannot proceed.`);
        }

        const isPolygon = targetChainId === 137;
        const atomicRouter = isPolygon ? getAtomicRouterAddress() : '';
        const isAtomicRouted = isPolygon && Boolean(atomicRouter) && isSwapRoutingSupported(atomicRouter);
        const feeWei = PAYFLUX_PLATFORM_FEE_WEI; // Exactly 100000000000000000n wei (0.1 POL)

        const validRouterTo = safeGetAddress(execRoute.transactionTo);
        if (!validRouterTo || validRouterTo === ZERO_ADDRESS) {
          throw new Error('Invalid router transaction address for payment routing.');
        }

        // The actual contract that must have ERC20 allowance to spend customer tokens:
        // When routing directly via QuickSwap (or DEX aggregators), the spender MUST be the DEX router, NOT PayFlux atomic router
        const spenderAddr = safeGetAddress(
          isAtomicRouted && atomicRouter
            ? atomicRouter
            : (execRoute.allowanceTarget || validRouterTo)
        );

        // Preflight & Token Approval: If paying with ERC20, verify & execute approval to the actual spender router
        if (!isNative) {
          const tokenContractAddr = srcTokenInfo?.address;
          if (!tokenContractAddr) {
            throw new Error(`Token contract for ${selectedPayToken} is not configured on ${selectedNetwork.toUpperCase()}.`);
          }

          if (!spenderAddr || spenderAddr === ZERO_ADDRESS) {
            throw new Error('Could not identify valid spender router address for token approval.');
          }

          const decimals = srcTokenInfo?.decimals || activePayTokenObj.decimals || (selectedPayToken === 'USDT' || selectedPayToken === 'USDC' ? 6 : 18);
          const parsedAmount = parseUnits(payAmountNum.toFixed(decimals > 6 ? 6 : decimals), decimals);

          // 1. Read current on-chain allowance for the actual spender (e.g. QuickSwap V2 Router)
          let currentAllowance = 0n;
          try {
            currentAllowance = (await (targetRpcClient as any).readContract({
              address: safeGetAddress(tokenContractAddr),
              abi: ERC20_STANDARD_ABI,
              functionName: 'allowance',
              args: [safeGetAddress(activeAddress), spenderAddr],
            })) as bigint;
          } catch (allowanceReadErr) {
            console.warn('[CustomerCheckout] Could not read token allowance, assuming 0:', allowanceReadErr);
            currentAllowance = 0n;
          }

          // 2. If allowance is insufficient, execute approval transaction for the correct router
          if (currentAllowance < parsedAmount) {
            console.log(`[CustomerCheckout] Allowance insufficient (${currentAllowance.toString()} < ${parsedAmount.toString()}). Approving ${selectedPayToken} for router ${spenderAddr}...`);

            const walletBrand = getConnectedWalletBrand(wallet?.brand || connector?.name);
            setSubmittingStepText({
              title: `Step 1/2: Approve ${selectedPayToken} in ${walletBrand}`,
              subtitle: `Please approve ${execRoute.routingProtocol || 'QuickSwap'} router to spend your ${selectedPayToken}.`,
            });

            // Resolve active wallet provider for reliable mobile/in-app signing
            let activeProvider: any = null;
            try {
              activeProvider = await getActiveWalletProvider(connector);
            } catch (_) {}

            let approveTxHash: `0x${string}` | null = null;
            let isApprovalAlreadyGrantedOnChain = false;
            try {
              approveTxHash = await executeTokenApproval({
                tokenAddress: safeGetAddress(tokenContractAddr),
                spenderAddress: spenderAddr,
                amount: maxUint256,
                account: safeGetAddress(activeAddress),
                chainId: targetChainId,
                connector,
                provider: activeProvider,
                writeContractAsync,
                walletName: connector?.name || wallet?.brand,
                timeoutMs: 75000,
              });
            } catch (approveErr: any) {
              const aErrStr = safeFormatError(approveErr).toLowerCase();
              if (
                aErrStr.includes('user rejected') ||
                aErrStr.includes('user denied') ||
                aErrStr.includes('rejected by user') ||
                aErrStr.includes('action_rejected') ||
                aErrStr.includes('disapproved') ||
                aErrStr.includes('cancelled')
              ) {
                throw new Error('Token approval was rejected in your wallet.');
              }

              // Check if allowance was already granted on-chain despite provider socket disconnect
              try {
                const currentAllow = (await (targetRpcClient as any).readContract({
                  address: safeGetAddress(tokenContractAddr),
                  abi: ERC20_STANDARD_ABI,
                  functionName: 'allowance',
                  args: [safeGetAddress(activeAddress), spenderAddr],
                })) as bigint;

                if (currentAllow >= parsedAmount) {
                  console.log('[CustomerCheckout] Allowance verified on-chain despite provider notice. Proceeding to Step 2!');
                  isApprovalAlreadyGrantedOnChain = true;
                } else {
                  throw new Error(`Token approval failed: ${safeFormatError(approveErr)}`);
                }
              } catch (innerErr) {
                throw new Error(`Token approval failed: ${safeFormatError(approveErr)}`);
              }
            }

            if (!isApprovalAlreadyGrantedOnChain) {
              if (!approveTxHash) {
                // Secondary check of allowance before failing
                const checkAllow = (await (targetRpcClient as any).readContract({
                  address: safeGetAddress(tokenContractAddr),
                  abi: ERC20_STANDARD_ABI,
                  functionName: 'allowance',
                  args: [safeGetAddress(activeAddress), spenderAddr],
                })) as bigint;

                if (checkAllow >= parsedAmount) {
                  isApprovalAlreadyGrantedOnChain = true;
                } else {
                  throw new Error('No approval transaction hash was returned by wallet.');
                }
              }

              if (!isApprovalAlreadyGrantedOnChain && approveTxHash) {
                // Wait for approval transaction receipt on-chain
                setSubmittingStepText({
                  title: `Confirming ${selectedPayToken} Approval on ${selectedNetwork.toUpperCase()}...`,
                  subtitle: `Waiting for blockchain confirmation of approval transaction...`,
                });

                const approveReceipt = await withTimeout(
                  targetRpcClient.waitForTransactionReceipt({
                    hash: approveTxHash,
                    timeout: 60000,
                  }),
                  60000,
                  'Token approval confirmation timed out on blockchain.'
                );

                if (!approveReceipt || approveReceipt.status === 'reverted' || (approveReceipt as any).status === 0) {
                  throw new Error(`Token approval transaction was reverted on ${selectedNetwork.toUpperCase()}.`);
                }

                // Verify updated allowance on-chain
                const verifiedAllowance = (await (targetRpcClient as any).readContract({
                  address: safeGetAddress(tokenContractAddr),
                  abi: ERC20_STANDARD_ABI,
                  functionName: 'allowance',
                  args: [safeGetAddress(activeAddress), spenderAddr],
                })) as bigint;

                if (verifiedAllowance < parsedAmount) {
                  throw new Error(`On-chain allowance update failed. Please verify approval in your wallet and try again.`);
                }
              }
            }

            console.log(`[CustomerCheckout] ${selectedPayToken} approval confirmed on-chain! Proceeding to swap execution.`);
          }

          // Move to Step 2 (Swap & Pay)
          const walletBrand = getConnectedWalletBrand(wallet?.brand || connector?.name);
          setSubmittingStepText({
            title: `Step 2/2: Confirm Payment in ${walletBrand}`,
            subtitle: `Please sign the payment transaction to complete merchant settlement.`,
          });
        }

        // Execute Swap / DLN Transaction to deliver merchantReceivingAsset to formattedMerchant
        const valWei = execRoute.transactionValue ? BigInt(execRoute.transactionValue) : 0n;

        let targetTxTo = validRouterTo;
        let targetTxData = execRoute.transactionData as `0x${string}`;
        let targetTxValue = valWei;

        if (isPolygon && isAtomicRouted && atomicRouter) {
          targetTxTo = safeGetAddress(atomicRouter);
          if (isNative) {
            // Native POL -> merchantReceivingAsset
            targetTxValue = valWei + feeWei;
            targetTxData = encodeAtomicSwapNative({
              targetRouter: validRouterTo,
              swapData: execRoute.transactionData as `0x${string}`,
            });
          } else {
            // ERC-20 -> merchantReceivingAsset
            const netContracts = TOKEN_CONTRACTS[targetChainId];
            const srcTokenInfo = netContracts ? netContracts[selectedPayToken] : null;
            const tokenContractAddr = srcTokenInfo?.address;
            const decimals = srcTokenInfo?.decimals || 18;
            const parsedAmount = parseUnits(payAmountNum.toFixed(decimals > 6 ? 6 : decimals), decimals);

            targetTxValue = feeWei;
            targetTxData = encodeAtomicSwapToken({
              targetRouter: validRouterTo,
              tokenIn: safeGetAddress(tokenContractAddr),
              amountIn: parsedAmount,
              swapData: execRoute.transactionData as `0x${string}`,
            });
          }
        }

        hash = await executeWalletTransaction({
          account: validPayer,
          to: targetTxTo,
          data: targetTxData,
          value: targetTxValue,
          chainId: targetChainId,
          connector,
          sendTransactionAsync,
          walletName: connector?.name,
          timeoutMs: 90000,
          promptMobileWallet: true,
          gas: execRoute.estimatedGasLimit,
        });

        routingUsed = isAtomicRouted ? `PayFlux Atomic Router (${execRoute.routingProtocol})` : execRoute.routingProtocol;
        finalMerchantReceivedAmount = execRoute.formattedAmountOut;
        finalMerchantReceivedAsset = merchantReceivingAsset;
      } else {
        // Direct Transfer (Customer is paying with the exact asset the merchant receives)
        const isPolygon = targetChainId === 137;

        if (isNative) {
          const valWei = parseEther(payAmountNum.toFixed(6));
          const targetTxTo = formattedMerchant;
          const targetTxData: `0x${string}` | undefined = undefined;
          const targetTxValue = valWei;

          hash = await executeWalletTransaction({
            account: validPayer,
            to: targetTxTo,
            data: targetTxData,
            value: targetTxValue,
            chainId: targetChainId,
            connector,
            sendTransactionAsync,
            walletName: connector?.name,
            timeoutMs: 90000,
            promptMobileWallet: true,
          });
        } else {
          const netContracts = TOKEN_CONTRACTS[targetChainId];
          const tokenInfo = netContracts ? netContracts[selectedPayToken] : null;
          const tokenContractAddr = tokenInfo?.address;
          if (!tokenContractAddr) {
            throw new Error(`Token contract for ${selectedPayToken} is not configured on this network.`);
          }
          const decimals = tokenInfo?.decimals || activePayTokenObj.decimals || (selectedPayToken === 'USDT' || selectedPayToken === 'USDC' ? 6 : 18);
          const parsedAmount = parseUnits(payAmountNum.toFixed(decimals > 6 ? 6 : decimals), decimals);

          const targetTxTo = safeGetAddress(tokenContractAddr);
          const targetTxData: `0x${string}` = encodeFunctionData({
            abi: ERC20_TRANSFER_ABI,
            functionName: 'transfer',
            args: [formattedMerchant, parsedAmount],
          });
          const targetTxValue = 0n;

          hash = await executeWalletTransaction({
            account: validPayer,
            to: targetTxTo,
            data: targetTxData,
            value: targetTxValue,
            chainId: targetChainId,
            connector,
            sendTransactionAsync,
            walletName: connector?.name,
            timeoutMs: 90000,
            promptMobileWallet: true,
          });
        }
        routingUsed = isPolygon ? 'PayFlux Direct Transfer' : 'Direct On-Chain Transfer';
        finalMerchantReceivedAmount = (basePriceUsd / (tokenQuote.tokenPriceUsd || 1)).toFixed(4);
        finalMerchantReceivedAsset = selectedPayToken;
      }

      if (!hash) {
        throw new Error('No transaction hash returned from wallet.');
      }

      submittedTxHash = hash;
      setTxHash(hash);
      setPaymentStatus('confirming');

      if (activeAttemptDataRef.current) {
        activeAttemptDataRef.current.txHash = hash;
        activeAttemptDataRef.current.routingUsed = routingUsed;
        activeAttemptDataRef.current.finalMerchantReceivedAmount = finalMerchantReceivedAmount;
        activeAttemptDataRef.current.finalMerchantReceivedAsset = finalMerchantReceivedAsset;
        try {
          sessionStorage.setItem('payflux_active_checkout_attempt', JSON.stringify(activeAttemptDataRef.current));
        } catch (_) {}
      }

      // Save pending transaction in history while waiting for blockchain confirmation
      if (activeAddress && isRealEVMHash(hash)) {
        saveTransaction({
          id: `pay_${attemptId}`,
          hash: hash,
          type: 'payment',
          tokenSymbol: selectedPayToken,
          amount: payAmountNum.toFixed(4),
          merchantName: merchantName || (checkoutMode === 'direct_address' ? 'Direct Wallet Recipient' : 'PayFlux Merchant'),
          productName: productName || (checkoutMode === 'direct_address' ? 'Direct Address Payment' : 'Goods & Services'),
          recipientAddress: formattedMerchant,
          senderAddress: activeAddress,
          userAddress: activeAddress,
          payerAddress: activeAddress,
          walletAddress: activeAddress,
          merchantReceivedAmount: finalMerchantReceivedAmount,
          merchantReceivedAsset: finalMerchantReceivedAsset,
          timestamp: Date.now(),
          status: 'pending',
          networkFeeUsd: 0.005,
          payfluxFeeUsd: 0,
          payfluxFeePol: 0,
          payfluxFeeDisplay: '0.1 POL (Pending)',
          feeStatus: 'pending',
          blockNumber: 0,
          explorerUrl: getExplorerTxUrl(selectedNetwork, hash),
          network: selectedNetwork,
        });
      }

      // STEP 5: Await Real On-Chain Block Receipt and Verify Confirmation
      let receipt: any = null;
      try {
        receipt = await withTimeout(
          targetRpcClient.waitForTransactionReceipt({
            hash: hash as `0x${string}`,
            timeout: 60000,
          }),
          60000,
          `Blockchain confirmation timed out. You can verify on explorer: ${getExplorerTxUrl(selectedNetwork, hash)}`
        );
      } catch (waitErr: any) {
        console.warn('[CustomerCheckout] waitForTransactionReceipt notice, checking getTransactionReceipt:', waitErr);
        try {
          receipt = await targetRpcClient.getTransactionReceipt({ hash: hash as `0x${string}` });
        } catch (_) {}
        if (!receipt) throw waitErr;
      }

      if (!receipt || (receipt.status !== 'success' && (receipt as any).status !== 1 && (receipt as any).status !== '0x1')) {
        const revertErr = new Error(`Transaction was reverted on-chain (status: ${receipt?.status || 'failed'}). Hash: ${hash}`);
        (revertErr as any).isRevertedOnChain = true;
        (revertErr as any).txHash = hash;
        throw revertErr;
      }

      // STEP 6: Finalize Payment State & Unified Receipt Presentation
      await finalizeSuccessfulPayment({
        txHash: hash,
        receipt,
        overrideAttemptData: {
          ...activeAttemptDataRef.current,
          routingUsed,
          finalMerchantReceivedAmount,
          finalMerchantReceivedAsset,
        },
      });
    } catch (err: any) {
      console.error('Payment execution failure:', err);

      // Before marking failed, check if the transaction (or user recent tx) was actually mined successfully!
      if (activeAddress) {
        try {
          const userAddr = safeGetAddress(activeAddress);
          const targetRpc = selectedNetwork === 'ethereum' ? ethereumRpcClient : polygonRpcClient;
          const hashToCheck = submittedTxHash || (await scanForRecentUserTx(targetRpc, userAddr, undefined, 35));
          if (hashToCheck && isRealEVMHash(hashToCheck)) {
            const rcpt = await targetRpc.getTransactionReceipt({ hash: hashToCheck as `0x${string}` });
            if (rcpt && (rcpt.status === 'success' || (rcpt as any).status === 1 || (rcpt as any).status === '0x1')) {
              console.log('[CustomerCheckout] Recovered successful payment in catch handler:', hashToCheck);
              await finalizeSuccessfulPayment({
                txHash: hashToCheck,
                receipt: rcpt,
                overrideAttemptData: activeAttemptDataRef.current,
              });
              return;
            }
          }
        } catch (recoverErr) {
          console.warn('[CustomerCheckout] Catch recovery notice:', recoverErr);
        }
      }

      isSubmittingRef.current = false;
      setSubmittingStepText(null);
      setPaymentStatus('failed');

      const rawMsg = typeof err === 'string'
        ? err
        : err?.shortMessage || err?.details || err?.message || 'Transaction was rejected or failed.';
      let cleanError = String(rawMsg);
      const lower = cleanError.toLowerCase();

      // ONLY report on-chain smart contract revert if a real transaction was submitted AND confirmed reverted on blockchain
      if (
        (err as any)?.isRevertedOnChain ||
        (submittedTxHash && (lower.includes('revert') || lower.includes('status: failed') || lower.includes('status: 0')))
      ) {
        const txUrl = submittedTxHash ? getExplorerTxUrl(selectedNetwork, submittedTxHash) : '';
        cleanError = `Payment Failed: On-chain transaction reverted on the blockchain (Tx: ${submittedTxHash || 'unknown'}). ${txUrl ? `View on explorer: ${txUrl}` : ''}`;
      } else if (
        lower.includes('user rejected') ||
        lower.includes('denied') ||
        lower.includes('user disapproved') ||
        lower.includes('action cancelled') ||
        lower.includes('rejected transaction') ||
        lower.includes('rejected by user')
      ) {
        cleanError = 'Payment Cancelled: Transaction request was rejected in your wallet.';
      } else if (
        lower.includes('transfer amount exceeds balance') ||
        lower.includes('exceeds balance')
      ) {
        cleanError = `Payment Failed: Transfer amount exceeds your available ${selectedPayToken} balance.`;
      } else if (
        lower.includes('insufficient funds') ||
        lower.includes('gas required exceeds allowance') ||
        lower.includes('insufficient pol balance')
      ) {
        cleanError = `Payment Failed: Insufficient funds or gas to complete this transaction.`;
      } else if (lower.includes('timeout') || lower.includes('timed out')) {
        cleanError = `Payment Notice: Transaction timed out waiting for wallet response. Please check your wallet application.`;
      } else if (lower.includes('route') || lower.includes('routing') || lower.includes('no valid on-chain route') || lower.includes('quote')) {
        cleanError = `Payment Preparation Notice: ${rawMsg}`;
      } else {
        // Clean preparation or validation notice
        cleanError = `Payment Preparation Notice: ${cleanError.replace(/^Error:\s*/, '')}`;
      }

      setErrorMessage(cleanError);
      recordPaymentFailure(attemptId, cleanError, submittedTxHash || undefined);

      // Record real blockchain failure in history if transaction broadcast failed/reverted on-chain
      if (submittedTxHash && isRealEVMHash(submittedTxHash) && activeAddress) {
        const recipientFallback = merchantAddress && isValidEVMAddress(merchantAddress)
          ? safeGetAddress(merchantAddress)
          : safeGetAddress(activeAddress);
        saveTransaction({
          id: `pay_${attemptId}`,
          hash: submittedTxHash,
          type: 'payment',
          tokenSymbol: selectedPayToken,
          amount: payAmountNum.toFixed(4),
          merchantName: merchantName || (checkoutMode === 'direct_address' ? 'Direct Wallet Recipient' : 'PayFlux Merchant'),
          productName: productName || (checkoutMode === 'direct_address' ? 'Direct Address Payment' : 'Goods & Services'),
          recipientAddress: recipientFallback,
          senderAddress: activeAddress,
          userAddress: activeAddress,
          payerAddress: activeAddress,
          walletAddress: activeAddress,
          timestamp: Date.now(),
          status: 'failed',
          networkFeeUsd: 0.005,
          payfluxFeeUsd: 0,
          payfluxFeePol: 0,
          payfluxFeeDisplay: '0 POL (Failed)',
          feeStatus: 'failed',
          blockNumber: 0,
          explorerUrl: getExplorerTxUrl(selectedNetwork, submittedTxHash),
          network: selectedNetwork,
          failureReason: cleanError,
        });
      }
    }
  };

  if (checkoutMode === 'share_pay_link') {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-6 pb-12">
        <SharePayLinkCheckout
          tokens={tokens}
          wallet={wallet}
          onOpenConnectModal={onOpenConnectModal}
          onPaymentSuccess={onPaymentSuccess}
          onResetToModeSelect={handleResetToModeSelect}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 pb-12">
      {/* Scanner Modal */}
      {isScannerOpen && (
        <QRScannerModal
          isOpen={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          onScanSuccess={handleQRScanSuccess}
        />
      )}

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-6 rounded-3xl shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="p-3.5 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-slate-950 font-bold shadow-lg shadow-cyan-500/20">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">{t('pay.title')}</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('pay.subtitle')}
            </p>
          </div>
        </div>

        {checkoutMode !== 'select_mode' && paymentStatus !== 'completed' && (
          <button
            onClick={handleResetToModeSelect}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors self-start sm:self-auto border border-slate-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('pay.change_merchant')}</span>
          </button>
        )}
      </div>

      {scanSuccessNotification && (
        <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs flex items-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="font-bold">{scanSuccessNotification}</span>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 1. INITIAL ENTRY VIEW: OPTION A (SCAN QR) & OPTION B (PASTE ADDRESS) */}
      {/* ------------------------------------------------------------- */}
      {checkoutMode === 'select_mode' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* OPTION A: SCAN MERCHANT QR */}
          <div className="bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-cyan-500/30 hover:border-cyan-400/60 rounded-3xl p-6 sm:p-7 shadow-2xl flex flex-col justify-between space-y-6 transition-all group">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-2xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 group-hover:scale-105 transition-transform">
                  <Camera className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  {t('pay.option_a')}
                </span>
              </div>

              <div>
                <h2 className="text-lg font-black text-white">{t('pay.scan_qr')}</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {t('pay.scan_qr_desc')}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2 text-[11px] text-slate-300">
                <div className="flex items-center gap-2 text-cyan-400 font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Dynamic Real-Time Data</span>
                </div>
                <p className="text-slate-400 text-[10px]">
                  Always pulls the merchant's latest price updates directly from the network registry.
                </p>
              </div>

              {directUploadError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{directUploadError}</span>
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <input
                ref={directFileInputRef}
                type="file"
                accept="image/*,.png,.jpg,.jpeg,.webp,.svg,.bmp,.heic"
                className="hidden"
                onChange={handleDirectImageUpload}
              />

              <button
                id="start-scan-qr-btn"
                onClick={() => setIsScannerOpen(true)}
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2"
              >
                <ScanLine className="w-4 h-4" />
                <span>{t('pay.open_scanner')}</span>
              </button>

              <button
                id="direct-upload-qr-btn"
                disabled={isDirectUploading}
                onClick={() => {
                  if (directFileInputRef.current) {
                    directFileInputRef.current.value = '';
                    directFileInputRef.current.click();
                  }
                }}
                className="w-full py-2.5 px-4 rounded-2xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 font-bold text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isDirectUploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                    <span>Analyzing Image...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t('pay.upload_qr')}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* OPTION B: PASTE MERCHANT ADDRESS */}
          <div className="bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 hover:border-slate-700 rounded-3xl p-6 sm:p-7 shadow-2xl flex flex-col justify-between space-y-6 transition-all">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  <ClipboardPaste className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  {t('pay.option_b')}
                </span>
              </div>

              <div>
                <h2 className="text-lg font-black text-white">{t('pay.paste_address')}</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {t('pay.paste_address_desc')}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-300">
                  {t('pay.merchant_address')}
                </label>
                <div className="relative">
                  <input
                    id="manual-merchant-address-input"
                    type="text"
                    value={manualAddressInput}
                    onChange={(e) => {
                      setManualAddressInput(e.target.value);
                      setManualAddressError(null);
                    }}
                    placeholder="0x..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                  />
                  {manualAddressInput && (
                    <button
                      type="button"
                      onClick={() => setManualAddressInput('')}
                      className="absolute right-3 top-2.5 text-xs text-slate-500 hover:text-slate-300"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {manualAddressError && (
                  <p className="text-[11px] text-rose-400 font-medium">{manualAddressError}</p>
                )}
              </div>
            </div>

            <button
              id="proceed-manual-address-btn"
              onClick={handleProceedWithManualAddress}
              className="w-full py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-black text-sm transition-all border border-slate-700 flex items-center justify-center gap-2"
            >
              <span>{t('pay.continue_address')}</span>
              <ArrowRight className="w-4 h-4 text-purple-400" />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 2. COMPLETED SUCCESS RECEIPT VIEW */}
      {/* ------------------------------------------------------------- */}
      {paymentStatus === 'completed' && (
        completedReceipt ? (
          <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 animate-fadeIn">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-black text-white">Payment Confirmed On-Chain!</h2>
              <p className="text-xs text-slate-400">
                Your transaction has been verified on the {completedReceipt.network} blockchain.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3 font-mono text-xs">
              <div className="flex justify-between items-center text-slate-400">
                <span>Merchant / Recipient:</span>
                <span className="font-bold text-white">{completedReceipt.merchantName}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Recipient Address:</span>
                <span className="font-mono text-slate-300">{shortenAddress(completedReceipt.merchantAddress, 6)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Product / Service:</span>
                <span className="font-bold text-cyan-300">{completedReceipt.productName}</span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Base Value:</span>
                <span className="text-white">
                  {completedReceipt.fiatCurrency || 'USD'} {completedReceipt.fiatAmount?.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>You Paid:</span>
                <span className="font-bold text-slate-200">
                  {completedReceipt.amountPaid} {completedReceipt.tokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400 pt-1 border-t border-slate-800/80">
                <span className="text-emerald-400 font-bold">Merchant Received:</span>
                <span className="font-bold text-emerald-400 text-sm">
                  {completedReceipt.merchantReceivedAmount || completedReceipt.amountPaid} {completedReceipt.merchantReceivedAsset || completedReceipt.tokenSymbol}
                </span>
              </div>
              {completedReceipt.routingProtocol && (
                <div className="flex justify-between items-center text-slate-400 text-[11px]">
                  <span>Settlement Route:</span>
                  <span className="text-purple-300 font-semibold">{completedReceipt.routingProtocol}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-slate-400">
                <span>PayFlux Platform Fee:</span>
                <span className={completedReceipt.feeStatus === 'confirmed' ? "text-cyan-400 font-bold" : "text-amber-400 font-bold"}>
                  {completedReceipt.feeStatus === 'confirmed'
                    ? (completedReceipt.payfluxFeeDisplay || `${completedReceipt.payfluxFeePol || 0.1} POL (Confirmed)`)
                    : (completedReceipt.payfluxFeeDisplay || '0 POL (Bypassed via DEX direct route)')}
                </span>
              </div>
              {completedReceipt.feeTxHash && completedReceipt.feeStatus === 'confirmed' && (
                <div className="flex justify-between items-center text-slate-400 text-[11px]">
                  <span>Fee Tx (Polygon):</span>
                  <a
                    href={`https://polygonscan.com/tx/${completedReceipt.feeTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:underline flex items-center gap-1 font-bold"
                  >
                    <span>{shortenAddress(completedReceipt.feeTxHash, 6)}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-slate-400">
                <span>Tx Hash:</span>
                <a
                  href={completedReceipt.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline flex items-center gap-1 font-bold"
                >
                  <span>{shortenAddress(completedReceipt.txHash, 6)}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleResetToModeSelect}
                className="w-full py-3.5 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs transition-colors shadow-lg shadow-cyan-500/20"
              >
                Make Another Payment
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center space-y-4">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
            <div className="text-white font-bold text-lg">Finalizing Payment Receipt...</div>
            <p className="text-slate-400 text-xs font-mono">Verifying block confirmation on-chain...</p>
          </div>
        )
      )}

      {/* ------------------------------------------------------------- */}
      {/* 3. ACTIVE MERCHANT CHECKOUT VIEW (FROM QR OR PROFILE) */}
      {/* ------------------------------------------------------------- */}
      {checkoutMode === 'merchant_checkout' && paymentStatus !== 'completed' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          {/* Merchant & Product Information Card */}
          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5" />
                <span>Verified PayFlux Merchant</span>
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {merchantNetwork.toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <div className="text-xs text-slate-400">Merchant</div>
                <div className="font-extrabold text-white text-base mt-0.5">{merchantName}</div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5">{shortenAddress(merchantAddress, 6)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Product / Item</div>
                <div className="font-extrabold text-cyan-300 text-base mt-0.5">{productName}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
              <div>
                <div className="text-xs text-slate-400">Price Amount</div>
                <div className="font-mono font-bold text-emerald-400 text-base mt-0.5">
                  {fiatInfo.symbol}{numPrice.toLocaleString()} {priceCurrency}
                  <span className="text-xs text-slate-400 font-normal ml-1.5">
                    (≈ ${basePriceUsd.toFixed(2)} USD)
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Merchant Payout Asset</div>
                <div className="font-bold text-purple-300 text-sm mt-0.5 flex items-center gap-1.5">
                  <span>{merchantReceivingAsset}</span>
                  <span className="text-xs text-slate-400 font-normal">on {merchantNetwork}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Customer Payment Asset Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300">
                Select Your Payment Crypto Asset (from Wallet)
              </label>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>Network:</span>
                <span className="font-bold text-white capitalize">{selectedNetwork}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {availableCustomerTokens.map((t) => {
                const isSelected = t.symbol === selectedPayToken;
                return (
                  <button
                    key={`${t.symbol}-${t.network}`}
                    type="button"
                    onClick={() => setSelectedPayToken(t.symbol)}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all ${
                      isSelected
                        ? 'bg-cyan-500/15 border-cyan-400 text-white shadow-md shadow-cyan-500/10'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <TokenIcon token={t} size="sm" />
                    <span className="font-bold text-xs mt-1">{t.symbol}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Bal: {t.balance.toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conversion Breakdown & PayFlux Platform Fee */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Merchant Item:</span>
              <span className="font-mono text-white">
                {fiatInfo.symbol}{numPrice.toLocaleString()} {priceCurrency} (${basePriceUsd.toFixed(2)} USD)
              </span>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1 text-cyan-400 font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>PayFlux Fixed Platform Fee:</span>
              </span>
              <span className="font-mono font-bold text-cyan-300">
                +0.1 POL
              </span>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Est. Network Gas:</span>
              <span className="font-mono text-slate-300">~ $0.005 USD</span>
            </div>

            {/* Merchant Final Receiving Output & Route */}
            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-purple-300 font-semibold flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Final Merchant Payout:</span>
                </span>
                <span className="font-mono font-bold text-purple-200">
                  {isLoadingRoute ? (
                    <span className="text-slate-400 text-xs">Routing quote...</span>
                  ) : activeSwapRoute ? (
                    `${activeSwapRoute.formattedAmountOut} ${merchantReceivingAsset}`
                  ) : (
                    `${(basePriceUsd / (tokenQuote.tokenPriceUsd || 1)).toFixed(4)} ${merchantReceivingAsset}`
                  )}
                </span>
              </div>

              {isConversionNeeded && (
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Routing Protocol:</span>
                  <span className="text-cyan-300 font-medium">
                    {isLoadingRoute ? 'Calculating DEX Route...' : activeSwapRoute?.routingProtocol || 'Automated DEX Route'}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">You Pay (in {selectedPayToken})</div>
                <div className="text-[11px] text-slate-500 font-mono">
                  {tokenQuote.exchangeRateText}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-black text-cyan-300 font-mono">
                  {isLoadingQuote ? (
                    <span className="text-sm text-slate-400">Calculating...</span>
                  ) : (
                    `${tokenQuote.tokenAmount} ${selectedPayToken}`
                  )}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  ≈ ${totalDueUsdWithFee.toFixed(2)} USD
                </div>
              </div>
            </div>
          </div>

          {routeError && (
            <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-rose-300">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                <span>Payment Route Unavailable</span>
              </div>
              <p className="text-[11px] text-rose-200/90 leading-relaxed">
                {routeError}
              </p>
              <p className="text-[10px] text-slate-400">
                PayFlux requires 100% on-chain delivery of the merchant's chosen asset ({merchantReceivingAsset}). Please choose a payment token with active liquidity or pay directly in {merchantReceivingAsset}.
              </p>
            </div>
          )}

          {isInsufficientBalance && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
              <div className="space-y-0.5">
                <div className="font-bold text-amber-200">Insufficient {selectedPayToken} Balance</div>
                <div className="text-[11px] text-amber-300/90 leading-relaxed">
                  Your connected wallet contains <span className="font-bold font-mono">{currentUserTokenBalance.toFixed(4)} {selectedPayToken}</span>, but this payment requires <span className="font-bold font-mono">{tokenQuote.tokenAmount} {selectedPayToken}</span>. Please choose a different payment token or add funds.
                </div>
              </div>
            </div>
          )}

          {/* Active Payment Progress States Banner */}
          {(paymentStatus === 'submitting' || paymentStatus === 'confirming') && (
            <div className="p-4 rounded-2xl bg-slate-950 border border-cyan-500/40 space-y-3">
              {/* Step Progress Tracker */}
              <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-800">
                <span className="text-slate-300">1. Details</span>
                <span>→</span>
                <span className={paymentStatus === 'submitting' ? 'text-cyan-400 font-bold' : 'text-slate-300'}>
                  2. Open Wallet & Sign
                </span>
                <span>→</span>
                <span className={paymentStatus === 'confirming' ? 'text-purple-400 font-bold' : 'text-slate-600'}>
                  3. Confirming
                </span>
              </div>

              <div className="flex items-center gap-2.5 text-xs text-slate-200">
                {paymentStatus === 'submitting' ? (
                  <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin flex-shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-purple-400 animate-spin flex-shrink-0" />
                )}
                <div>
                  <div className="font-bold text-white">
                    {paymentStatus === 'submitting'
                      ? (submittingStepText?.title || `Waiting for signature in ${getConnectedWalletBrand(wallet?.brand)}...`)
                      : `Transaction submitted — verifying block confirmation...`}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {paymentStatus === 'submitting'
                      ? (submittingStepText?.subtitle || 'Please approve the transaction prompt in your wallet app.')
                      : `Awaiting blockchain confirmation on ${selectedNetwork.toUpperCase()}.`}
                  </div>
                </div>
              </div>

              {paymentStatus === 'submitting' && (
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => triggerMobileWalletPrompt(wallet?.brand || 'Bitcoin.com Wallet', undefined, true)}
                      className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500/25 via-sky-500/25 to-blue-600/25 hover:from-cyan-500/35 hover:to-blue-600/35 border border-cyan-500/50 text-cyan-200 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Wallet className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">
                        {submittingStepText?.title?.includes('Step 2/2')
                          ? `Open ${getConnectedWalletBrand(wallet?.brand)} (Step 2/2)`
                          : `Open ${getConnectedWalletBrand(wallet?.brand)} App`}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={isCheckingOnChain}
                      onClick={handleCheckOnChainStatus}
                      className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all flex items-center justify-center gap-2"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 flex-shrink-0 ${isCheckingOnChain ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
                      <span>{isCheckingOnChain ? 'Checking Blockchain...' : "I've Signed — Check Status"}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center">
                    PayFlux automatically resumes checking when you return from your wallet.
                  </p>
                </div>
              )}
            </div>
          )}

          {errorMessage && paymentStatus === 'failed' && (
            <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-rose-300 text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-400" />
                <span>Payment Notice</span>
              </div>
              <p className="text-xs text-rose-200/90 leading-relaxed">{errorMessage}</p>
              <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                🛡️ <span className="font-semibold text-slate-300">Safe Settlement:</span> No cryptocurrency was deducted from your wallet and no payment was credited to the merchant.
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2.5">
            {!isWalletConnected ? (
              <button
                type="button"
                onClick={onOpenConnectModal}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/20"
              >
                Connect Wallet to Pay
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  isInsufficientBalance ||
                  paymentStatus === 'submitting' ||
                  paymentStatus === 'confirming' ||
                  isLoadingQuote ||
                  isLoadingRoute ||
                  !tokenQuote.isAvailable ||
                  (isConversionNeeded && (!activeSwapRoute || !activeSwapRoute.success))
                }
                onClick={handleExecutePayment}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
              >
                {isInsufficientBalance ? (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>Insufficient {selectedPayToken} Balance</span>
                  </>
                ) : isConversionNeeded && routeError ? (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>Route Unavailable — Select Another Token</span>
                  </>
                ) : paymentStatus === 'submitting' ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>
                      {submittingStepText?.title?.includes('Approve')
                        ? 'Waiting for Token Approval...'
                        : 'Waiting for Wallet Approval...'}
                    </span>
                  </>
                ) : paymentStatus === 'confirming' ? (
                  <>
                    <Clock className="w-4 h-4 animate-spin" />
                    <span>Confirming on Blockchain...</span>
                  </>
                ) : paymentStatus === 'failed' ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Try Again ({tokenQuote.tokenAmount} {selectedPayToken})</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      Pay {tokenQuote.tokenAmount} {selectedPayToken}
                      {isConversionNeeded && ` (Delivers ${merchantReceivingAsset})`}
                    </span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleResetToModeSelect}
              className="w-full py-2.5 rounded-xl text-xs text-slate-400 hover:text-white transition-colors"
            >
              Cancel & Scan Different Merchant
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. OPTION B DIRECT ADDRESS PAYMENT VIEW */}
      {/* ------------------------------------------------------------- */}
      {checkoutMode === 'direct_address' && paymentStatus !== 'completed' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-purple-400 font-bold flex items-center gap-1.5">
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Direct Address Payment</span>
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {selectedNetwork.toUpperCase()}
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-slate-400">Recipient Address</div>
              <div className="font-mono text-sm font-bold text-white break-all">{merchantAddress}</div>
            </div>

            {/* Custom Amount Entry */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">Payment Amount</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    value={directAmount}
                    onChange={(e) => setDirectAmount(e.target.value)}
                    placeholder="10"
                    className="w-full pl-3 pr-16 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                  />
                  <div className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold">
                    {directCurrency}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">Currency</label>
                <select
                  value={directCurrency}
                  onChange={(e) => setDirectCurrency(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-bold focus:border-cyan-500 focus:outline-none"
                >
                  {Object.entries(SUPPORTED_FIAT_CURRENCIES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Payment Asset Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300">
                Select Your Payment Crypto Asset
              </label>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>Network:</span>
                <span className="font-bold text-white capitalize">{selectedNetwork}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {availableCustomerTokens.map((t) => {
                const isSelected = t.symbol === selectedPayToken;
                return (
                  <button
                    key={`${t.symbol}-${t.network}`}
                    type="button"
                    onClick={() => setSelectedPayToken(t.symbol)}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all ${
                      isSelected
                        ? 'bg-cyan-500/15 border-cyan-400 text-white shadow-md shadow-cyan-500/10'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <TokenIcon token={t} size="sm" />
                    <span className="font-bold text-xs mt-1">{t.symbol}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Bal: {t.balance.toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fee & Conversion Breakdown */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Amount to Recipient:</span>
              <span className="font-mono text-white">
                {fiatInfo.symbol}{numPrice.toLocaleString()} {directCurrency} (${basePriceUsd.toFixed(2)} USD)
              </span>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1 text-cyan-400 font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>PayFlux Fixed Platform Fee:</span>
              </span>
              <span className="font-mono font-bold text-cyan-300">
                +0.1 POL
              </span>
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">You Pay (in {selectedPayToken})</div>
                <div className="text-[11px] text-slate-500 font-mono">
                  {tokenQuote.exchangeRateText}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-black text-cyan-300 font-mono">
                  {isLoadingQuote ? (
                    <span className="text-sm text-slate-400">Calculating...</span>
                  ) : (
                    `${tokenQuote.tokenAmount} ${selectedPayToken}`
                  )}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  ≈ ${totalDueUsdWithFee.toFixed(2)} USD
                </div>
              </div>
            </div>
          </div>

          {isInsufficientBalance && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
              <div className="space-y-0.5">
                <div className="font-bold text-amber-200">Insufficient {selectedPayToken} Balance</div>
                <div className="text-[11px] text-amber-300/90 leading-relaxed">
                  Your connected wallet contains <span className="font-bold font-mono">{currentUserTokenBalance.toFixed(4)} {selectedPayToken}</span>, but this payment requires <span className="font-bold font-mono">{tokenQuote.tokenAmount} {selectedPayToken}</span>. Please choose a different payment token or add funds.
                </div>
              </div>
            </div>
          )}

          {/* Active Payment Progress States Banner */}
          {(paymentStatus === 'submitting' || paymentStatus === 'confirming') && (
            <div className="p-4 rounded-2xl bg-slate-950 border border-purple-500/40 space-y-3">
              {/* Step Progress Tracker */}
              <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-800">
                <span className="text-slate-300">1. Details</span>
                <span>→</span>
                <span className={paymentStatus === 'submitting' ? 'text-purple-400 font-bold' : 'text-slate-300'}>
                  2. Open Wallet & Sign
                </span>
                <span>→</span>
                <span className={paymentStatus === 'confirming' ? 'text-cyan-400 font-bold' : 'text-slate-600'}>
                  3. Confirming
                </span>
              </div>

              <div className="flex items-center gap-2.5 text-xs text-slate-200">
                {paymentStatus === 'submitting' ? (
                  <RefreshCw className="w-4 h-4 text-purple-400 animate-spin flex-shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-cyan-400 animate-spin flex-shrink-0" />
                )}
                <div>
                  <div className="font-bold text-white">
                    {paymentStatus === 'submitting'
                      ? (submittingStepText?.title || `Waiting for signature in ${getConnectedWalletBrand(wallet?.brand)}...`)
                      : `Transaction submitted — verifying block confirmation...`}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {paymentStatus === 'submitting'
                      ? (submittingStepText?.subtitle || 'Please approve the transaction prompt in your wallet app.')
                      : `Awaiting blockchain confirmation on ${selectedNetwork.toUpperCase()}.`}
                  </div>
                </div>
              </div>

              {paymentStatus === 'submitting' && (
                <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                  <button
                    type="button"
                    onClick={() => triggerMobileWalletPrompt(wallet?.brand || 'Bitcoin.com Wallet')}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-500/20 via-indigo-500/20 to-blue-600/20 hover:from-purple-500/30 hover:to-blue-600/30 border border-purple-500/40 text-purple-200 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    <span>Open {getConnectedWalletBrand(wallet?.brand)} App</span>
                  </button>
                  <p className="text-[10px] text-slate-400 text-center">
                    PayFlux automatically resumes checking when you return.
                  </p>
                </div>
              )}
            </div>
          )}

          {errorMessage && paymentStatus === 'failed' && (
            <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-rose-300 text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-400" />
                <span>Payment Notice</span>
              </div>
              <p className="text-xs text-rose-200/90 leading-relaxed">{errorMessage}</p>
              <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                🛡️ <span className="font-semibold text-slate-300">Safe Settlement:</span> No cryptocurrency was deducted from your wallet and no payment was credited to the recipient.
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2.5">
            {!isWalletConnected ? (
              <button
                type="button"
                onClick={onOpenConnectModal}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/20"
              >
                Connect Wallet to Pay
              </button>
            ) : (
              <button
                type="button"
                disabled={isInsufficientBalance || paymentStatus === 'submitting' || paymentStatus === 'confirming' || isLoadingQuote || !tokenQuote.isAvailable}
                onClick={handleExecutePayment}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
              >
                {isInsufficientBalance ? (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>Insufficient {selectedPayToken} Balance</span>
                  </>
                ) : paymentStatus === 'submitting' ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>
                      {submittingStepText?.title?.includes('Approve')
                        ? 'Waiting for Token Approval...'
                        : 'Waiting for Wallet Approval...'}
                    </span>
                  </>
                ) : paymentStatus === 'confirming' ? (
                  <>
                    <Clock className="w-4 h-4 animate-spin" />
                    <span>Confirming on Blockchain...</span>
                  </>
                ) : paymentStatus === 'failed' ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Try Again ({tokenQuote.tokenAmount} {selectedPayToken})</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Send {tokenQuote.tokenAmount} {selectedPayToken}</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleResetToModeSelect}
              className="w-full py-2.5 rounded-xl text-xs text-slate-400 hover:text-white transition-colors"
            >
              Cancel & Back to Mode Selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
