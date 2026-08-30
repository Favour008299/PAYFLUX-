import React, { useState, useEffect, useMemo } from 'react';
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
import { parseUnits, parseEther, formatEther, formatUnits, getAddress, maxUint256 } from 'viem';
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
  recordPaymentAttempt,
  recordPaymentFailure,
  getMerchantProfile,
  fetchMerchantProfile,
  saveMerchantProfile,
  subscribeToPaymentUpdates,
  subscribeToMerchantProfileUpdates
} from '../services/paymentStorage';
import {
  PAYFLUX_PLATFORM_FEE_POL,
  PAYFLUX_PLATFORM_FEE_DISPLAY,
  PAYFLUX_PLATFORM_FEE_USD,
  PAYFLUX_TREASURY_ADDRESS,
  SUPPORTED_FIAT_CURRENCIES,
  MerchantProfile
} from '../config/platform';
import { executeAndVerifyPlatformFee, checkSufficientFeeBalance } from '../services/payfluxFeeService';
import {
  TOKEN_CONTRACTS,
  ERC20_TRANSFER_ABI,
  getExplorerTxUrl
} from '../services/contractConfig';
import { shortenAddress, formatCurrency, isValidEVMAddress } from '../utils/crypto';
import { safeGetAddress, getUnifiedSwapQuote, SwapRouteQuote, ZERO_ADDRESS } from '../services/sharedSwapEngine';
import {
  triggerMobileWalletPrompt,
  setupWalletReturnDetector,
  getConnectedWalletBrand,
} from '../services/walletSigningService';
import { TokenIcon } from './TokenIcon';
import { QRScannerModal } from './QRScannerModal';
import { ParsedQRPayment, parseQRPaymentData } from '../utils/qrParser';
import { decodeQRCodeFromImageFile } from '../utils/qrReader';
import { trackEvent } from '../services/analytics';

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

type CheckoutMode = 'select_mode' | 'merchant_checkout' | 'direct_address';

export const CustomerCheckout: React.FC<CustomerCheckoutProps> = ({
  initialInvoiceId,
  wallet,
  tokens,
  settings,
  onOpenConnectModal,
  onPaymentSuccess,
  onNavigateToMerchantHub,
}) => {
  const { open } = useAppKit();
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  // Mode: select_mode (initial 2 options) | merchant_checkout | direct_address
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>(initialInvoiceId ? 'merchant_checkout' : 'select_mode');

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
  const [txHash, setTxHash] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedReceipt, setCompletedReceipt] = useState<CustomerPaymentReceipt | null>(null);
  const [scanSuccessNotification, setScanSuccessNotification] = useState<string | null>(null);

  const isSubmittingRef = React.useRef(false);

  // Return detector: when user returns from Bitcoin.com Wallet app back to browser tab
  useEffect(() => {
    if (paymentStatus !== 'submitting' && paymentStatus !== 'confirming') return;

    const cleanup = setupWalletReturnDetector(async () => {
      console.log('[CustomerCheckout] User returned from wallet app. Checking payment status...');
      if (paymentStatus === 'confirming' && txHash && publicClient) {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
          if (receipt && receipt.status === 'success') {
            setPaymentStatus('completed');
          }
        } catch (_) {}
      }
    });

    return () => cleanup();
  }, [paymentStatus, txHash, publicClient]);

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
  const isInsufficientBalance = isConnected && requiredPayAmount > 0 && currentUserTokenBalance < requiredPayAmount;

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
  };

  // Live Conversion Calculation for Merchant Checkout or Direct Address Flow
  const currentFiatCurrency = checkoutMode === 'merchant_checkout' ? priceCurrency : directCurrency;
  const currentFiatAmountStr = checkoutMode === 'merchant_checkout' ? priceAmount : directAmount;
  const fiatInfo = SUPPORTED_FIAT_CURRENCIES[currentFiatCurrency] || SUPPORTED_FIAT_CURRENCIES.USD;
  const numPrice = parseFloat(currentFiatAmountStr) || 0;
  const basePriceUsd = currentFiatCurrency === 'USD' ? numPrice : numPrice / (fiatInfo.rate || 1);
  const totalDueUsdWithFee = basePriceUsd;

  // Conversion determination
  const isConversionNeeded = checkoutMode === 'merchant_checkout' 
    ? (selectedPayToken.toUpperCase() !== merchantReceivingAsset.toUpperCase() || selectedNetwork.toLowerCase() !== merchantNetwork.toLowerCase())
    : false;

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
            userAddress: address || undefined,
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
    address,
  ]);

  // Execute Real On-Chain Payment
  const handleExecutePayment = async () => {
    if (isSubmittingRef.current || paymentStatus === 'submitting' || paymentStatus === 'confirming') {
      return;
    }

    if (!isConnected || !address) {
      onOpenConnectModal();
      return;
    }

    if (!merchantAddress || !isValidEVMAddress(merchantAddress)) {
      setErrorMessage('Please provide a valid merchant EVM recipient address.');
      setPaymentStatus('failed');
      return;
    }

    const payAmountNum = parseFloat(tokenQuote.tokenAmount);
    if (isNaN(payAmountNum) || payAmountNum <= 0) {
      setErrorMessage('Invalid payment amount. Please wait for the quote to load.');
      setPaymentStatus('failed');
      return;
    }

    if (isConversionNeeded && (!activeSwapRoute || !activeSwapRoute.success || !activeSwapRoute.transactionData)) {
      setErrorMessage(
        routeError ||
        `Payment cannot be completed: No valid on-chain route exists to convert ${selectedPayToken} into ${merchantReceivingAsset}. Please choose a supported payment token.`
      );
      setPaymentStatus('failed');
      return;
    }

    isSubmittingRef.current = true;
    setPaymentStatus('submitting');
    setErrorMessage(null);

    // Prompt mobile wallet app to open if on mobile
    triggerMobileWalletPrompt(wallet?.brand || 'Bitcoin.com Wallet');

    const attemptId = recordPaymentAttempt({
      invoiceId: activeInvoiceId || undefined,
      merchantName: merchantName || (checkoutMode === 'direct_address' ? 'Direct Wallet Recipient' : 'PayFlux Merchant'),
      merchantAddress: merchantAddress,
      productName: productName || (checkoutMode === 'direct_address' ? 'Direct Address Payment' : 'Goods & Services'),
      payerAddress: address,
      amountPaid: payAmountNum.toFixed(4),
      tokenSymbol: selectedPayToken,
      fiatValueUsd: totalDueUsdWithFee,
      fiatAmount: numPrice,
      fiatCurrency: currentFiatCurrency,
      network: selectedNetwork,
      chainId: selectedNetwork === 'ethereum' ? 1 : 137,
    });

    try {
      const isNative =
        (selectedNetwork === 'polygon' && selectedPayToken === 'POL') ||
        (selectedNetwork === 'ethereum' && selectedPayToken === 'ETH');

      const targetChainId = selectedNetwork === 'ethereum' ? 1 : 137;
      const formattedMerchant = safeGetAddress(merchantAddress);

      // STEP 0: Check Sufficient POL Fee Balance (0.1 POL + Gas) on Polygon
      const feeCheck = await checkSufficientFeeBalance({
        userAddress: address,
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
        if (publicClient) {
          try {
            onChainBalanceRaw = await publicClient.getBalance({
              address: safeGetAddress(address),
            });
            userOnChainFormatted = parseFloat(formatEther(onChainBalanceRaw));
          } catch (readErr) {
            console.warn('Could not read native on-chain balance via publicClient:', readErr);
            onChainBalanceRaw = parseEther(currentUserTokenBalance.toFixed(6));
          }

          if (onChainBalanceRaw < requiredWei) {
            const err = `Insufficient ${selectedPayToken} balance. Your wallet has ${userOnChainFormatted.toFixed(4)} ${selectedPayToken}, but this payment requires ${payAmountNum.toFixed(4)} ${selectedPayToken}.`;
            setErrorMessage(err);
            setPaymentStatus('failed');
            return;
          }
        } else if (currentUserTokenBalance < payAmountNum) {
          const err = `Insufficient ${selectedPayToken} balance. Your wallet has ${currentUserTokenBalance.toFixed(4)} ${selectedPayToken}, but this payment requires ${payAmountNum.toFixed(4)} ${selectedPayToken}.`;
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

        if (publicClient) {
          try {
            onChainBalanceRaw = (await (publicClient as any).readContract({
              address: safeGetAddress(tokenContractAddr),
              abi: ERC20_TRANSFER_ABI,
              functionName: 'balanceOf',
              args: [safeGetAddress(address)],
            })) as bigint;
            userOnChainFormatted = parseFloat(formatUnits(onChainBalanceRaw, decimals));
          } catch (readErr) {
            console.warn('Could not read ERC20 on-chain balance via publicClient:', readErr);
            userOnChainFormatted = currentUserTokenBalance;
            onChainBalanceRaw = parseUnits(currentUserTokenBalance.toString(), decimals);
          }

          if (onChainBalanceRaw < parsedAmount) {
            const err = `Insufficient ${selectedPayToken} balance. Your wallet has ${userOnChainFormatted.toFixed(4)} ${selectedPayToken}, but this payment requires ${payAmountNum.toFixed(4)} ${selectedPayToken}.`;
            setErrorMessage(err);
            setPaymentStatus('failed');
            return;
          }
        } else if (currentUserTokenBalance < payAmountNum) {
          const err = `Insufficient ${selectedPayToken} balance. Your wallet has ${currentUserTokenBalance.toFixed(4)} ${selectedPayToken}, but this payment requires ${payAmountNum.toFixed(4)} ${selectedPayToken}.`;
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

      // STEP 3: Collect and Verify Fixed 0.1 POL Platform Fee On-Chain to Revenue Wallet
      console.log('[CustomerCheckout] Collecting and verifying 0.1 POL platform fee on-chain to', PAYFLUX_TREASURY_ADDRESS);
      const feeResult = await executeAndVerifyPlatformFee({
        payerAddress: address,
        chainId: targetChainId,
        tokenSymbol: selectedPayToken,
        sendTransactionAsync,
        activeProvider: (connector as any)?.getProvider ? await (connector as any).getProvider() : undefined,
      });

      if (!feeResult.success || feeResult.feeStatus !== 'confirmed' || !feeResult.feeTxHash) {
        const stopReason = feeResult.error || '0.1 POL platform fee could not be verified on-chain.';
        console.warn('[CustomerCheckout] Payment stopped because fee collection was not confirmed on blockchain:', stopReason);
        setErrorMessage(`Payment Stopped: ${stopReason} For security, no funds were sent to the merchant.`);
        setPaymentStatus('failed');
        recordPaymentFailure(attemptId, stopReason);
        isSubmittingRef.current = false;
        return;
      }

      console.log('[CustomerCheckout] 0.1 POL platform fee successfully confirmed on-chain:', feeResult.feeTxHash);

      // STEP 4: Route Execution or Direct Payment to Merchant (Single User Confirmation in Wallet)
      let hash = '';
      let routingUsed: string | undefined = undefined;
      let finalMerchantReceivedAmount = payAmountNum.toFixed(4);
      let finalMerchantReceivedAsset = selectedPayToken;

      if (isConversionNeeded) {
        // Must convert customer input token to merchant receiving asset via DEX/Bridge routing
        if (!activeSwapRoute || !activeSwapRoute.success || !activeSwapRoute.transactionData || !activeSwapRoute.transactionTo) {
          throw new Error(`Payment cannot be completed: No valid on-chain route exists to convert ${selectedPayToken} into ${merchantReceivingAsset}. Please select a supported payment token.`);
        }

        // If paying with ERC20, check and execute token approval to router/bridge contract
        if (!isNative) {
          const netContracts = TOKEN_CONTRACTS[targetChainId];
          const tokenInfo = netContracts ? netContracts[selectedPayToken] : null;
          const tokenContractAddr = tokenInfo?.address;
          const spenderAddr = safeGetAddress(activeSwapRoute.allowanceTarget || activeSwapRoute.transactionTo);

          if (tokenContractAddr && spenderAddr && publicClient) {
            try {
              const currentAllowance = (await (publicClient as any).readContract({
                address: safeGetAddress(tokenContractAddr),
                abi: ERC20_TRANSFER_ABI,
                functionName: 'allowance',
                args: [safeGetAddress(address), spenderAddr],
              })) as bigint;

              const decimals = tokenInfo.decimals || 18;
              const parsedAmount = parseUnits(payAmountNum.toFixed(decimals > 6 ? 6 : decimals), decimals);

              if (currentAllowance < parsedAmount) {
                console.log(`Approving ${selectedPayToken} for swap router ${spenderAddr}...`);
                const approveTxHash = await (writeContractAsync as any)({
                  address: safeGetAddress(tokenContractAddr),
                  abi: ERC20_TRANSFER_ABI,
                  functionName: 'approve',
                  args: [spenderAddr, maxUint256],
                });

                if (approveTxHash && publicClient) {
                  await publicClient.waitForTransactionReceipt({
                    hash: approveTxHash as `0x${string}`,
                    timeout: 60000,
                  });
                }
              }
            } catch (allowanceErr: any) {
              console.warn('Allowance check/approval warning:', allowanceErr);
            }
          }
        }

        // Execute Swap / DLN Transaction to deliver merchantReceivingAsset to formattedMerchant
        const valWei = activeSwapRoute.transactionValue ? BigInt(activeSwapRoute.transactionValue) : 0n;
        hash = await sendTransactionAsync({
          to: safeGetAddress(activeSwapRoute.transactionTo),
          data: activeSwapRoute.transactionData as `0x${string}`,
          value: valWei,
        });

        routingUsed = activeSwapRoute.routingProtocol;
        finalMerchantReceivedAmount = activeSwapRoute.formattedAmountOut;
        finalMerchantReceivedAsset = merchantReceivingAsset;
      } else {
        // Direct Transfer (Customer is paying with the exact asset the merchant receives)
        if (isNative) {
          const valWei = parseEther(payAmountNum.toFixed(6));
          hash = await sendTransactionAsync({
            to: formattedMerchant,
            value: valWei,
          });
        } else {
          const netContracts = TOKEN_CONTRACTS[targetChainId];
          const tokenInfo = netContracts ? netContracts[selectedPayToken] : null;
          const tokenContractAddr = tokenInfo?.address;
          const decimals = tokenInfo?.decimals || activePayTokenObj.decimals || (selectedPayToken === 'USDT' || selectedPayToken === 'USDC' ? 6 : 18);
          const parsedAmount = parseUnits(payAmountNum.toFixed(decimals > 6 ? 6 : decimals), decimals);

          hash = await (writeContractAsync as any)({
            address: safeGetAddress(tokenContractAddr!),
            abi: ERC20_TRANSFER_ABI,
            functionName: 'transfer',
            args: [formattedMerchant, parsedAmount],
          });
        }
        routingUsed = 'Direct On-Chain Transfer';
        finalMerchantReceivedAmount = (basePriceUsd / (tokenQuote.tokenPriceUsd || 1)).toFixed(4);
        finalMerchantReceivedAsset = selectedPayToken;
      }

      if (!hash) {
        throw new Error('No transaction hash returned from wallet.');
      }

      setTxHash(hash);
      setPaymentStatus('confirming');

      // STEP 5: Await Real On-Chain Block Receipt and Verify Confirmation
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: hash as `0x${string}`,
          timeout: 60000,
        });

        if (!receipt || receipt.status !== 'success') {
          throw new Error(`Transaction was reverted on-chain (status: ${receipt?.status || 'failed'}). Hash: ${hash}`);
        }
      }

      // STEP 6: ONLY ON CONFIRMED ON-CHAIN SUCCESS: Record Receipt & Update State
      const completedReceiptObj: CustomerPaymentReceipt = {
        id: attemptId,
        invoiceId: activeInvoiceId || undefined,
        merchantName: merchantName || (checkoutMode === 'direct_address' ? 'Direct Wallet Recipient' : 'PayFlux Merchant'),
        merchantAddress: formattedMerchant,
        productName: productName || (checkoutMode === 'direct_address' ? 'Direct Address Payment' : 'Goods & Services'),
        payerAddress: address,
        amountPaid: payAmountNum.toFixed(4),
        tokenSymbol: selectedPayToken,
        merchantReceivedAmount: finalMerchantReceivedAmount,
        merchantReceivedAsset: finalMerchantReceivedAsset,
        routingProtocol: routingUsed,
        isConverted: isConversionNeeded,
        fiatValueUsd: basePriceUsd,
        fiatAmount: numPrice,
        fiatCurrency: currentFiatCurrency,
        payfluxFeePol: PAYFLUX_PLATFORM_FEE_POL,
        payfluxFeeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
        payfluxFeeUsd: 0.10,
        feeToken: 'POL',
        feeAmountToken: '0.1',
        feeNetwork: 'Polygon',
        feeStatus: 'confirmed',
        feeTxHash: feeResult.feeTxHash,
        feeRecipient: PAYFLUX_TREASURY_ADDRESS,
        feeBlockNumber: feeResult.feeBlockNumber,
        txHash: hash,
        network: selectedNetwork,
        chainId: targetChainId,
        timestamp: Date.now(),
        status: 'completed',
        networkFeeUsd: 0.005,
        explorerUrl: getExplorerTxUrl(selectedNetwork, hash),
      };

      saveCustomerReceipt(completedReceiptObj);
      setCompletedReceipt(completedReceiptObj);

      trackEvent('payment_success', {
        fiatAmount: completedReceiptObj.fiatAmount,
        fiatCurrency: completedReceiptObj.fiatCurrency,
        tokenSymbol: completedReceiptObj.tokenSymbol,
        amountPaid: completedReceiptObj.amountPaid,
        network: completedReceiptObj.network,
        merchantAddress: completedReceiptObj.merchantAddress,
      });

      // Update merchant invoice status if linked
      if (activeInvoiceId) {
        updateInvoiceStatus(activeInvoiceId, {
          status: 'paid',
          paidTxHash: hash,
          payerAddress: address,
          paidToken: selectedPayToken,
          paidAmount: payAmountNum.toFixed(4),
          paidTimestamp: Date.now(),
          payfluxFeePol: PAYFLUX_PLATFORM_FEE_POL,
          payfluxFeeDisplay: PAYFLUX_PLATFORM_FEE_DISPLAY,
          payfluxFeeUsd: 0.10,
        });
      }

      isSubmittingRef.current = false;
      setPaymentStatus('completed');
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
      });

      if (onPaymentSuccess) {
        onPaymentSuccess(completedReceiptObj);
      }
    } catch (err: any) {
      console.error('Payment execution failure:', err);
      isSubmittingRef.current = false;
      setPaymentStatus('failed');

      let rawMsg = err?.shortMessage || err?.message || 'Transaction was rejected or failed on-chain.';
      let cleanError = rawMsg;

      if (
        rawMsg.toLowerCase().includes('transfer amount exceeds balance') ||
        rawMsg.toLowerCase().includes('exceeds balance')
      ) {
        cleanError = `Payment Failed: Transfer amount exceeds your available ${selectedPayToken} balance.`;
      } else if (
        rawMsg.toLowerCase().includes('user rejected') ||
        rawMsg.toLowerCase().includes('denied') ||
        rawMsg.toLowerCase().includes('user disapproved')
      ) {
        cleanError = 'Payment Cancelled: Transaction request was rejected in your wallet.';
      } else if (
        rawMsg.toLowerCase().includes('insufficient funds') ||
        rawMsg.toLowerCase().includes('gas required exceeds allowance')
      ) {
        cleanError = `Payment Failed: Insufficient gas or token funds to complete this transaction.`;
      } else if (rawMsg.toLowerCase().includes('reverted')) {
        cleanError = `Payment Failed: On-chain smart contract execution reverted.`;
      }

      setErrorMessage(cleanError);
      recordPaymentFailure(attemptId, cleanError, txHash || undefined);
    }
  };

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
            <h1 className="text-xl font-extrabold text-white">Customer Payment & Checkout</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Pay merchants securely using your preferred crypto asset. Settle directly with zero custodial intermediaries.
            </p>
          </div>
        </div>

        {checkoutMode !== 'select_mode' && paymentStatus !== 'completed' && (
          <button
            onClick={handleResetToModeSelect}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors self-start sm:self-auto border border-slate-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Change Merchant / Mode</span>
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
                  Option A
                </span>
              </div>

              <div>
                <h2 className="text-lg font-black text-white">Scan Merchant QR</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Scan a PayFlux Merchant QR code with your camera or upload an image to automatically retrieve the merchant's live product details, dynamic pricing, and preferred receiving asset.
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
                <span>Open QR Scanner / Camera</span>
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
                    <span>Upload QR Image File</span>
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
                  Option B
                </span>
              </div>

              <div>
                <h2 className="text-lg font-black text-white">Paste Merchant Address</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Enter the merchant's public EVM wallet address to initiate a direct payment. Specify your custom amount and choose any crypto asset in your connected wallet.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-300">
                  Merchant EVM Wallet Address
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
              <span>Continue with Address</span>
              <ArrowRight className="w-4 h-4 text-purple-400" />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 2. COMPLETED SUCCESS RECEIPT VIEW */}
      {/* ------------------------------------------------------------- */}
      {paymentStatus === 'completed' && completedReceipt && (
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
              <span className="text-cyan-400 font-bold">
                {completedReceipt.payfluxFeeDisplay || (completedReceipt.payfluxFeePol ? `${completedReceipt.payfluxFeePol} POL` : '0.1 POL')}
              </span>
            </div>
            {completedReceipt.feeTxHash && (
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
                      ? `Waiting for signature in ${getConnectedWalletBrand(wallet?.brand)}...`
                      : `Transaction submitted — verifying block confirmation...`}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {paymentStatus === 'submitting'
                      ? 'Please approve the transaction prompt in your wallet app.'
                      : `Awaiting blockchain confirmation on ${selectedNetwork.toUpperCase()}.`}
                  </div>
                </div>
              </div>

              {paymentStatus === 'submitting' && (
                <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                  <button
                    type="button"
                    onClick={() => triggerMobileWalletPrompt(wallet?.brand || 'Bitcoin.com Wallet')}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500/20 via-sky-500/20 to-blue-600/20 hover:from-cyan-500/30 hover:to-blue-600/30 border border-cyan-500/40 text-cyan-200 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
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
                🛡️ <span className="font-semibold text-slate-300">Safe Settlement:</span> No cryptocurrency was deducted from your wallet and no payment was credited to the merchant.
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2.5">
            {!isConnected ? (
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
                    <span>Waiting for Wallet Approval...</span>
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
                      ? `Waiting for signature in ${getConnectedWalletBrand(wallet?.brand)}...`
                      : `Transaction submitted — verifying block confirmation...`}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {paymentStatus === 'submitting'
                      ? 'Please approve the transaction prompt in your wallet app.'
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
            {!isConnected ? (
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
                    <span>Waiting for Wallet Approval...</span>
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
