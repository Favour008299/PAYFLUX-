import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeftRight,
  LayoutDashboard,
  Clock,
  Coins,
  ShieldCheck,
  Zap,
  CheckCircle2,
  AlertCircle,
  Copy,
  TrendingUp,
  X,
  Store,
  Receipt,
  CreditCard,
  Download
} from 'lucide-react';

import { useAccount, useDisconnect as useWagmiDisconnect, useBalance, useChainId, useReconnect } from 'wagmi';
import { reconnect } from '@wagmi/core';
import { formatUnits } from 'viem';
import { disconnectWalletSession, wagmiAdapter } from './config/web3';
import { useAppKit } from './hooks/useAppKit';
import { trackPageView, trackEvent } from './services/analytics';

import {
  Token,
  WalletAccount,
  SwapQuote,
  TransactionRecord,
  UserSettings,
  NetworkType,
  CustomerPaymentReceipt
} from './types';
import { INITIAL_TOKENS, INITIAL_TRANSACTIONS } from './data/tokens';
import { generateTxHash } from './utils/crypto';
import { getLiveTokenPrices } from './services/livePricing';
import { fetchRealOnchainBalances, RealWalletBalances } from './services/realOnchainBalances';
import {
  getStoredTransactions,
  saveTransaction,
  deleteTransaction,
  clearAllTransactions,
  subscribeToHistory,
} from './services/historyStorage';

// Components
import { Navbar } from './components/Navbar';
import { LandingHero } from './components/LandingHero';
import { SwapCard } from './components/SwapCard';
import { CustomerCheckout } from './components/CustomerCheckout';
import { MerchantHub } from './components/MerchantHub';
import { PaymentsDashboard } from './components/PaymentsDashboard';
import { HomeDashboard } from './components/HomeDashboard';
import { HistoryView } from './components/HistoryView';
import { EarnModal } from './components/EarnModal';
import { AdminDashboard } from './components/AdminDashboard';
import { TokenSelectorModal } from './components/TokenSelectorModal';
import { SwapConfirmationModal } from './components/SwapConfirmationModal';
import { WalletConnectModal } from './components/WalletConnectModal';
import { CreateWalletModal } from './components/CreateWalletModal';
import { SendModal } from './components/SendModal';
import { ReceiveModal } from './components/ReceiveModal';
import { SettingsModal } from './components/SettingsModal';
import { FiatOnrampModal } from './components/FiatOnrampModal';
import { ExplorerModal } from './components/ExplorerModal';
import { ReceiptShareModal } from './components/ReceiptShareModal';
import { ChartDrawer } from './components/ChartDrawer';

export default function App() {
  // App Navigation
  const [activeTab, setActiveTab] = useState<'swap' | 'pay' | 'merchant' | 'payments' | 'dashboard' | 'history' | 'earn' | 'admin'>('swap');
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);

  // Read URL query params on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const inv = params.get('invoice') || params.get('pay');
      if (inv) {
        setPayInvoiceId(inv);
        setActiveTab('pay');
      }
    }
  }, []);

  // Track virtual pageviews on tab changes
  useEffect(() => {
    trackPageView(activeTab);
  }, [activeTab]);

  // Real WalletConnect & Wagmi Hooks
  const { open } = useAppKit();
  const { address: wagmiAddress, isConnected: wagmiConnected, connector } = useAccount();
  const chainId = useChainId();
  const { disconnectAsync: wagmiDisconnectAsync } = useWagmiDisconnect();
  const { reconnect: wagmiReconnect } = useReconnect();

  const [isExplicitlyDisconnected, setIsExplicitlyDisconnected] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('payflux_explicitly_disconnected') === 'true';
    }
    return false;
  });

  // Wallet State - Only populated when an active live session exists or restored from local storage
  const [wallet, setWallet] = useState<WalletAccount | null>(() => {
    if (typeof window !== 'undefined') {
      const isDisc = localStorage.getItem('payflux_explicitly_disconnected') === 'true';
      if (!isDisc) {
        const savedWallet = localStorage.getItem('payflux_connected_wallet');
        if (savedWallet) {
          try {
            return JSON.parse(savedWallet);
          } catch (_) {}
        }
        const savedAddr = localStorage.getItem('payflux_connected_address');
        if (savedAddr && savedAddr.startsWith('0x')) {
          const savedName = localStorage.getItem('payflux_connected_wallet_name') || 'Connected Wallet';
          return {
            address: savedAddr as `0x${string}`,
            name: savedName,
            type: 'wallet_connect',
            recoveryPhraseBackedUp: true,
            network: 'polygon',
            portfolioBalanceUsd: 0,
            tokens: { VERSE: 0, POL: 0, ETH: 0, USDT: 0, USDC: 0, DAI: 0, BTC: 0, BCH: 0, WBTC: 0 },
            createdAt: Date.now(),
          };
        }
      }
    }
    return null;
  });

  // Active address & verified live connection boolean - stays true always until user explicitly disconnects
  const activeAddress = (wagmiAddress || (wallet?.address as `0x${string}`) || (typeof window !== 'undefined' && !isExplicitlyDisconnected ? (localStorage.getItem('payflux_connected_address') as `0x${string}`) : undefined)) || undefined;
  const isTrulyConnected = Boolean(activeAddress && !isExplicitlyDisconnected);

  // Persistent Wallet Session Auto-Reconnection
  // Keep connected to wallet always until the user explicitly clicks disconnect
  useEffect(() => {
    const isDisc = typeof window !== 'undefined' && localStorage.getItem('payflux_explicitly_disconnected') === 'true';
    if (!isDisc) {
      try {
        wagmiReconnect();
      } catch (err) {
        console.warn('[PayFlux Auto-Reconnect] notice:', err);
      }
      try {
        reconnect(wagmiAdapter.wagmiConfig).catch((err) => {
          console.warn('[PayFlux Auto-Reconnect Core] notice:', err);
        });
      } catch (_) {}
    }
  }, [wagmiReconnect]);

  // Window Focus & Visibility Reconnection Guard
  // When user returns from wallet app or switches browser tabs, keep the active session alive
  useEffect(() => {
    const handleRecheckSession = () => {
      if (document.visibilityState === 'visible') {
        const isDisc = typeof window !== 'undefined' && localStorage.getItem('payflux_explicitly_disconnected') === 'true';
        if (!isDisc && !wagmiConnected && (wallet?.address || (typeof window !== 'undefined' && localStorage.getItem('payflux_connected_address')))) {
          try {
            wagmiReconnect();
          } catch (_) {}
        }
      }
    };

    window.addEventListener('focus', handleRecheckSession);
    document.addEventListener('visibilitychange', handleRecheckSession);
    return () => {
      window.removeEventListener('focus', handleRecheckSession);
      document.removeEventListener('visibilitychange', handleRecheckSession);
    };
  }, [wagmiConnected, wallet?.address, wagmiReconnect]);

  // When a wallet is connected, keep it saved in localStorage and clear disconnected override
  useEffect(() => {
    if (activeAddress && !isExplicitlyDisconnected) {
      setIsExplicitlyDisconnected(false);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('payflux_explicitly_disconnected');
        localStorage.setItem('payflux_connected_address', activeAddress);
        if (connector?.name) {
          localStorage.setItem('payflux_connected_wallet_name', connector.name);
        }
      }
      trackEvent('wallet_connect', {
        address: activeAddress,
        connector: connector?.name || wallet?.name || 'Injected/WalletConnect',
        chainId,
      });
    }
  }, [wagmiConnected, activeAddress, connector?.name, chainId, isExplicitlyDisconnected, wallet?.address, wallet?.name]);

  // Persist wallet state changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (wallet && !isExplicitlyDisconnected) {
        localStorage.setItem('payflux_connected_wallet', JSON.stringify(wallet));
        localStorage.setItem('payflux_connected_address', wallet.address);
        if (wallet.name) {
          localStorage.setItem('payflux_connected_wallet_name', wallet.name);
        }
      }
    }
  }, [wallet, isExplicitlyDisconnected]);

  const { data: realBalance } = useBalance({
    address: isTrulyConnected ? activeAddress : undefined,
  });

  // Core App Data & State
  const [tokens, setTokens] = useState<Token[]>(INITIAL_TOKENS);
  const currentWalletAddress = (isTrulyConnected && activeAddress) ? activeAddress : (wallet?.address || '');
  const [transactions, setTransactions] = useState<TransactionRecord[]>(() => getStoredTransactions(currentWalletAddress));
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkType>('polygon');

  // Keep transactions in sync with real-time persistent history storage for the connected wallet
  useEffect(() => {
    if (!currentWalletAddress) {
      setTransactions([]);
      return;
    }
    setTransactions(getStoredTransactions(currentWalletAddress));
    const unsub = subscribeToHistory(() => {
      setTransactions(getStoredTransactions(currentWalletAddress));
    });
    return unsub;
  }, [currentWalletAddress]);

  // Exact portfolio value calculated across all tokens holding balance
  const totalPortfolioUsd = useMemo(() => {
    if (!wallet) return 0;
    return tokens.reduce((acc, t) => {
      const price = t.priceUsd || 0;
      return acc + (t.balance * price);
    }, 0);
  }, [wallet, tokens]);

  // Keep wallet.portfolioBalanceUsd synced with totalPortfolioUsd
  useEffect(() => {
    if (wallet && Math.abs(wallet.portfolioBalanceUsd - totalPortfolioUsd) > 0.00001) {
      setWallet((prev) => (prev ? { ...prev, portfolioBalanceUsd: totalPortfolioUsd } : null));
    }
  }, [totalPortfolioUsd, wallet?.address]);

  // Settings State
  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('verseswap_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return {
      theme: 'dark',
      currency: 'USD',
      slippageTolerance: 0.5,
      gasSpeed: 'standard',
      autoLockMinutes: 15,
      pinProtected: false,
      expertMode: false,
      audioFeedback: true,
    };
  });

  // Active Tokens for Swap
  const [fromToken, setFromToken] = useState<Token>(() => {
    return INITIAL_TOKENS.find((t) => t.id === 'pol-polygon') || INITIAL_TOKENS.find((t) => t.symbol === 'POL') || INITIAL_TOKENS[1];
  });
  const [toToken, setToToken] = useState<Token>(() => {
    return INITIAL_TOKENS.find((t) => t.id === 'verse-polygon') || INITIAL_TOKENS[0];
  });

  // Modal Control States
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isCreateWalletModalOpen, setIsCreateWalletModalOpen] = useState(false);
  const [tokenSelectorTarget, setTokenSelectorTarget] = useState<'from' | 'to' | null>(null);
  const [activeQuote, setActiveQuote] = useState<SwapQuote | null>(null);
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'analytics' | 'wallets' | 'security' | 'about' | 'admin'>('general');
  const [isFiatModalOpen, setIsFiatModalOpen] = useState(false);
  const [inspectedTx, setInspectedTx] = useState<TransactionRecord | null>(null);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [receiptTx, setReceiptTx] = useState<TransactionRecord | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isChartOpen, setIsChartOpen] = useState(false);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastCompletedSwapTimestamp, setLastCompletedSwapTimestamp] = useState<number>(0);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Synchronize real WalletConnect connection to app state
  useEffect(() => {
    if (!isTrulyConnected || !activeAddress) {
      if (isExplicitlyDisconnected) {
        setWallet(null);
        setTokens((prev) => prev.map((t) => (t.balance > 0 ? { ...t, balance: 0 } : t)));
      }
      return;
    }

    const net: NetworkType =
      chainId === 1
        ? 'ethereum'
        : chainId === 137
        ? 'polygon'
        : chainId === 56
        ? 'bnb'
        : chainId === 43114
        ? 'avalanche'
        : 'polygon';

    const formattedNativeBalance = realBalance
      ? parseFloat(parseFloat(formatUnits(realBalance.value, realBalance.decimals)).toFixed(4))
      : 0;

    const walletDisplayName =
      connector?.name ||
      (typeof window !== 'undefined' ? localStorage.getItem('payflux_connected_wallet_name') : null) ||
      'Connected Wallet';

    // Immediately reflect native balance in tokens state
    if (formattedNativeBalance > 0) {
      setTokens((prev) =>
        prev.map((t) => {
          if (net === 'polygon' && (t.id === 'pol-polygon' || (t.network === 'polygon' && t.symbol === 'POL'))) {
            return { ...t, balance: formattedNativeBalance };
          }
          if (net === 'ethereum' && (t.id === 'eth-ethereum' || (t.network === 'ethereum' && t.symbol === 'ETH'))) {
            return { ...t, balance: formattedNativeBalance };
          }
          return t;
        })
      );
    }

    setWallet((prev) => {
      if (prev && prev.address.toLowerCase() === activeAddress.toLowerCase()) {
        return {
          ...prev,
          name: walletDisplayName,
          network: net,
          tokens: {
            ...prev.tokens,
            ...(net === 'polygon' ? { POL: formattedNativeBalance } : {}),
            ...(net === 'ethereum' ? { ETH: formattedNativeBalance } : {}),
          },
        };
      }

      return {
        address: activeAddress,
        name: walletDisplayName,
        type: 'wallet_connect',
        recoveryPhraseBackedUp: true,
        network: net,
        portfolioBalanceUsd: 0,
        tokens: {
          VERSE: 0,
          POL: net === 'polygon' ? formattedNativeBalance : 0,
          ETH: net === 'ethereum' ? formattedNativeBalance : 0,
          USDT: 0,
          USDC: 0,
          DAI: 0,
          BTC: 0,
          BCH: 0,
          WBTC: 0,
        },
        createdAt: Date.now(),
      };
    });

    setSelectedNetwork(net);
  }, [isTrulyConnected, activeAddress, chainId, realBalance, connector?.name]);

  // Selected Network synchronization
  useEffect(() => {
    if (!wallet?.network) return;
    setSelectedNetwork(wallet.network);
  }, [wallet?.network]);

  // Continuously fetch REAL on-chain balances whenever wallet address is connected
  useEffect(() => {
    if (!wallet?.address || isExplicitlyDisconnected) return;

    let isMounted = true;
    const targetAddr = wallet.address;

    async function syncRealBalances() {
      try {
        const realBal = await fetchRealOnchainBalances(targetAddr);
        if (!isMounted) return;

        // Update tokens array with exact on-chain balance per token id / network
        setTokens((prev) =>
          prev.map((t) => {
            const tokenId = t.id || `${t.symbol.toLowerCase()}-${t.network.toLowerCase()}`;
            if (realBal.byTokenId && typeof realBal.byTokenId[tokenId] === 'number') {
              return { ...t, balance: realBal.byTokenId[tokenId] };
            }
            const netKey = `${t.network.toLowerCase()}:${t.symbol.toUpperCase()}`;
            if (realBal.byNetworkAndSymbol && typeof realBal.byNetworkAndSymbol[netKey] === 'number') {
              return { ...t, balance: realBal.byNetworkAndSymbol[netKey] };
            }
            const sym = t.symbol as keyof RealWalletBalances;
            if (sym in realBal && typeof realBal[sym] === 'number') {
              return { ...t, balance: realBal[sym] as number };
            }
            return t;
          })
        );

        // Also update fromToken and toToken live balances
        setFromToken((prev) => {
          const tokenId = prev.id || `${prev.symbol.toLowerCase()}-${prev.network.toLowerCase()}`;
          const bal = realBal.byTokenId?.[tokenId] ?? realBal.byNetworkAndSymbol?.[`${prev.network.toLowerCase()}:${prev.symbol.toUpperCase()}`];
          if (typeof bal === 'number') {
            return { ...prev, balance: bal };
          }
          return prev;
        });

        setToToken((prev) => {
          const tokenId = prev.id || `${prev.symbol.toLowerCase()}-${prev.network.toLowerCase()}`;
          const bal = realBal.byTokenId?.[tokenId] ?? realBal.byNetworkAndSymbol?.[`${prev.network.toLowerCase()}:${prev.symbol.toUpperCase()}`];
          if (typeof bal === 'number') {
            return { ...prev, balance: bal };
          }
          return prev;
        });

        // Update wallet object tokens
        setWallet((prev) => {
          if (!prev || prev.address.toLowerCase() !== targetAddr.toLowerCase()) return prev;
          return {
            ...prev,
            tokens: {
              ...prev.tokens,
              POL: realBal.POL,
              USDT: realBal.USDT,
              USDC: realBal.USDC,
              DAI: realBal.DAI,
              WBTC: realBal.WBTC,
              VERSE: realBal.VERSE,
              ETH: realBal.ETH,
              'polygon:VERSE': realBal.byNetworkAndSymbol?.['polygon:VERSE'] ?? realBal.VERSE,
              'ethereum:VERSE': realBal.byNetworkAndSymbol?.['ethereum:VERSE'] ?? 0,
              'polygon:POL': realBal.POL,
              'ethereum:ETH': realBal.ETH,
            },
            tokenBalancesById: realBal.byTokenId,
          };
        });
      } catch (err) {
        console.warn('Real balance sync notice:', err);
      }
    }

    syncRealBalances();
    const interval = setInterval(syncRealBalances, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [wallet?.address, isExplicitlyDisconnected]);

  // Clear any legacy localStorage wallet persistence on initial load
  useEffect(() => {
    localStorage.removeItem('verseswap_wallet');
    localStorage.removeItem('payflux_wallet');
  }, []);

  // Sync settings to localStorage
  useEffect(() => {
    localStorage.setItem('verseswap_settings', JSON.stringify(settings));
    if (settings.theme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }, [settings]);

  // Real-time live market pricing engine for all tokens including VERSE
  useEffect(() => {
    let isCancelled = false;

    async function fetchRealTokenPrices() {
      try {
        const { prices } = await getLiveTokenPrices();
        if (isCancelled || !prices || Object.keys(prices).length === 0) return;

        setTokens((prevTokens) =>
          prevTokens.map((t) => {
            const tokenId = t.id || `${t.symbol.toLowerCase()}-${t.network.toLowerCase()}`;
            const netKey = `${t.network.toLowerCase()}:${t.symbol.toUpperCase()}`;
            const liveData = prices[tokenId] || prices[netKey] || prices[t.symbol.toUpperCase()];
            if (liveData && !liveData.isPriceUnavailable && liveData.priceUsd > 0) {
              return {
                ...t,
                priceUsd: liveData.priceUsd,
                change24h: liveData.change24h !== undefined ? liveData.change24h : t.change24h,
                isPriceUnavailable: false,
              };
            }
            return {
              ...t,
              priceUsd: 0,
              isPriceUnavailable: true,
            };
          })
        );

        // Also update fromToken and toToken live prices
        setFromToken((prev) => {
          const tokenId = prev.id || `${prev.symbol.toLowerCase()}-${prev.network.toLowerCase()}`;
          const netKey = `${prev.network.toLowerCase()}:${prev.symbol.toUpperCase()}`;
          const liveData = prices[tokenId] || prices[netKey] || prices[prev.symbol.toUpperCase()];
          if (liveData && !liveData.isPriceUnavailable && liveData.priceUsd > 0) {
            return {
              ...prev,
              priceUsd: liveData.priceUsd,
              change24h: liveData.change24h !== undefined ? liveData.change24h : prev.change24h,
              isPriceUnavailable: false,
            };
          }
          return {
            ...prev,
            priceUsd: 0,
            isPriceUnavailable: true,
          };
        });

        setToToken((prev) => {
          const tokenId = prev.id || `${prev.symbol.toLowerCase()}-${prev.network.toLowerCase()}`;
          const netKey = `${prev.network.toLowerCase()}:${prev.symbol.toUpperCase()}`;
          const liveData = prices[tokenId] || prices[netKey] || prices[prev.symbol.toUpperCase()];
          if (liveData && !liveData.isPriceUnavailable && liveData.priceUsd > 0) {
            return {
              ...prev,
              priceUsd: liveData.priceUsd,
              change24h: liveData.change24h !== undefined ? liveData.change24h : prev.change24h,
              isPriceUnavailable: false,
            };
          }
          return {
            ...prev,
            priceUsd: 0,
            isPriceUnavailable: true,
          };
        });
      } catch (err) {
        console.warn('Live pricing fetch:', err);
      }
    }

    // Initial fetch
    fetchRealTokenPrices();

    // Periodic refresh every 15 seconds
    const interval = setInterval(fetchRealTokenPrices, 15000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Update token balances in state when wallet changes
  useEffect(() => {
    if (wallet) {
      setTokens((prev) =>
        prev.map((t) => {
          const tokenId = t.id || `${t.symbol.toLowerCase()}-${t.network.toLowerCase()}`;
          const netKey = `${t.network.toLowerCase()}:${t.symbol.toUpperCase()}`;
          const bal = wallet.tokenBalancesById?.[tokenId] ?? wallet.tokens[netKey] ?? wallet.tokens[t.symbol];
          return {
            ...t,
            balance: typeof bal === 'number' ? bal : t.balance,
          };
        })
      );
    }
  }, [wallet]);

  // Open Real WalletConnect modal directly
  const handleOpenConnect = async () => {
    setIsExplicitlyDisconnected(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('payflux_explicitly_disconnected');
    }
    try {
      await open({ view: 'Connect' });
    } catch (e) {
      console.error('WalletConnect open error:', e);
      setIsConnectModalOpen(true);
    }
  };

  // Disconnect wallet
  const handleDisconnectWallet = async () => {
    // 1. Immediately reset state and persist user's explicit disconnect intent
    setIsExplicitlyDisconnected(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('payflux_explicitly_disconnected', 'true');
      localStorage.removeItem('payflux_connected_wallet');
      localStorage.removeItem('payflux_connected_address');
      localStorage.removeItem('payflux_connected_wallet_name');
    }
    setWallet(null);
    setTokens(INITIAL_TOKENS);
    setFromToken((prev) => ({ ...prev, balance: 0 }));
    setToToken((prev) => ({ ...prev, balance: 0 }));

    // 2. Perform provider & storage disconnect
    try {
      if (wagmiDisconnectAsync) {
        await wagmiDisconnectAsync();
      }
    } catch (e) {
      console.warn('Wagmi disconnect error:', e);
    }

    try {
      await disconnectWalletSession();
    } catch (e) {
      console.warn('Session disconnect error:', e);
    }

    trackEvent('wallet_disconnect');
    showToast('Wallet disconnected');
  };

  // Token Flip handler
  const handleSwapPair = () => {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
  };

  // Swap Execution Locking & Single-Execution Deduplication
  const isSwapBusyRef = useRef(false);
  const processedSwapTxHashesRef = useRef<Set<string>>(new Set());

  // Initiate Swap Flow (Pops up only once)
  const handleInitiateSwap = (quote: SwapQuote) => {
    if (isConfirmationOpen || isSwapBusyRef.current) {
      return;
    }
    if (!isTrulyConnected || !wallet || !activeAddress) {
      showToast('Please connect an active wallet to execute swap');
      handleOpenConnect();
      return;
    }
    setActiveQuote(quote);
    trackEvent('swap_initiated', {
      fromToken: quote.fromToken.symbol,
      toToken: quote.toToken.symbol,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      network: quote.fromToken.network,
    });
    setIsConfirmationOpen(true);
  };

  // Processing Completed -> Deduct balances & record transaction
  const handleProcessingComplete = async (txData: Partial<TransactionRecord>) => {
    if (!activeQuote) return;

    const txHash = txData.hash || generateTxHash();

    // Guard against duplicate processing of the same transaction
    if (processedSwapTxHashesRef.current.has(txHash)) {
      console.log('[App] Swap transaction already processed for hash:', txHash);
      return;
    }
    processedSwapTxHashesRef.current.add(txHash);
    isSwapBusyRef.current = false;

    const blockNum = txData.blockNumber || 62892340;
    const expUrl = txData.explorerUrl || `https://polygonscan.com/tx/${txHash}`;

    // Record Transaction
    const newTx: TransactionRecord = {
      id: `tx-${Date.now()}`,
      hash: txHash,
      type: 'swap',
      fromTokenSymbol: activeQuote.fromToken.symbol,
      toTokenSymbol: activeQuote.toToken.symbol,
      fromAmount: activeQuote.fromAmount,
      toAmount: activeQuote.toAmount,
      userAddress: currentWalletAddress,
      senderAddress: currentWalletAddress,
      payerAddress: currentWalletAddress,
      walletAddress: currentWalletAddress,
      timestamp: Date.now(),
      status: 'completed',
      networkFeeUsd: activeQuote.networkFeeUsd,
      payfluxFeeUsd: txData.feeStatus === 'confirmed' ? (txData.payfluxFeeUsd ?? 0.10) : 0,
      payfluxFeePol: txData.feeStatus === 'confirmed' ? (txData.payfluxFeePol ?? 0.1) : 0,
      payfluxFeeDisplay: txData.feeStatus === 'confirmed' ? (txData.payfluxFeeDisplay || '0.1 POL') : '0 POL (Failed)',
      feeStatus: txData.feeStatus === 'confirmed' && txData.feeTxHash ? 'confirmed' : 'failed',
      feeTxHash: txData.feeStatus === 'confirmed' ? txData.feeTxHash : undefined,
      blockNumber: blockNum,
      explorerUrl: expUrl,
      network: activeQuote.fromToken.network,
      orderId: txData.orderId || activeQuote.orderId,
    };

    saveTransaction(newTx);
    setTransactions((prev) => [newTx, ...prev.filter((item) => item.id !== newTx.id)]);

    trackEvent('swap_success', {
      fromToken: newTx.fromTokenSymbol,
      toToken: newTx.toTokenSymbol,
      fromAmount: newTx.fromAmount,
      toAmount: newTx.toAmount,
      hash: newTx.hash,
    });

    // Notify user with accurate swap & platform fee details (never trigger false "Payment received" on a swap)
    showToast(
      `Swap Confirmed: ${activeQuote.fromAmount} ${activeQuote.fromToken.symbol} → ${activeQuote.toAmount} ${activeQuote.toToken.symbol} (Platform Fee: -0.1 POL)`
    );

    // Reset input amount on swap card
    setLastCompletedSwapTimestamp(Date.now());

    // Optimistic balance update for instant UX feedback
    const numFrom = parseFloat(activeQuote.fromAmount) || 0;
    const numTo = parseFloat(activeQuote.toAmount) || 0;
    setTokens((prev) =>
      prev.map((t) => {
        if (t.symbol === activeQuote.fromToken.symbol && t.network === activeQuote.fromToken.network) {
          return { ...t, balance: Math.max(0, t.balance - numFrom) };
        }
        if (t.symbol === activeQuote.toToken.symbol && t.network === activeQuote.toToken.network) {
          return { ...t, balance: t.balance + numTo };
        }
        return t;
      })
    );

    setFromToken((prev) => ({
      ...prev,
      balance: Math.max(0, prev.balance - numFrom),
    }));

    setToToken((prev) => ({
      ...prev,
      balance: prev.balance + numTo,
    }));

    // Refresh real on-chain balances with immediate + staggered retries for blockchain block indexing
    if (wallet?.address) {
      const syncOnchain = async () => {
        try {
          const freshBal = await fetchRealOnchainBalances(wallet.address);
          setTokens((prev) =>
            prev.map((t) => {
              const tokenId = t.id || `${t.symbol.toLowerCase()}-${t.network.toLowerCase()}`;
              if (freshBal.byTokenId && typeof freshBal.byTokenId[tokenId] === 'number') {
                return { ...t, balance: freshBal.byTokenId[tokenId] };
              }
              const netKey = `${t.network.toLowerCase()}:${t.symbol.toUpperCase()}`;
              if (freshBal.byNetworkAndSymbol && typeof freshBal.byNetworkAndSymbol[netKey] === 'number') {
                return { ...t, balance: freshBal.byNetworkAndSymbol[netKey] };
              }
              const sym = t.symbol as keyof RealWalletBalances;
              if (sym in freshBal && typeof freshBal[sym] === 'number') {
                return { ...t, balance: freshBal[sym] as number };
              }
              return t;
            })
          );

          setFromToken((prev) => {
            const tokenId = prev.id || `${prev.symbol.toLowerCase()}-${prev.network.toLowerCase()}`;
            const bal = freshBal.byTokenId?.[tokenId] ?? freshBal.byNetworkAndSymbol?.[`${prev.network.toLowerCase()}:${prev.symbol.toUpperCase()}`];
            if (typeof bal === 'number') {
              return { ...prev, balance: bal };
            }
            return prev;
          });

          setToToken((prev) => {
            const tokenId = prev.id || `${prev.symbol.toLowerCase()}-${prev.network.toLowerCase()}`;
            const bal = freshBal.byTokenId?.[tokenId] ?? freshBal.byNetworkAndSymbol?.[`${prev.network.toLowerCase()}:${prev.symbol.toUpperCase()}`];
            if (typeof bal === 'number') {
              return { ...prev, balance: bal };
            }
            return prev;
          });

          setWallet((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              tokens: {
                ...prev.tokens,
                POL: freshBal.POL,
                USDT: freshBal.USDT,
                USDC: freshBal.USDC,
                DAI: freshBal.DAI,
                WBTC: freshBal.WBTC,
                VERSE: freshBal.VERSE,
                ETH: freshBal.ETH,
                'polygon:VERSE': freshBal.byNetworkAndSymbol?.['polygon:VERSE'] ?? freshBal.VERSE,
                'ethereum:VERSE': freshBal.byNetworkAndSymbol?.['ethereum:VERSE'] ?? 0,
                'polygon:POL': freshBal.POL,
                'ethereum:ETH': freshBal.ETH,
              },
              tokenBalancesById: freshBal.byTokenId,
            };
          });
        } catch (e) {
          console.warn('Post-swap balance refresh notice:', e);
        }
      };

      // Multi-interval sync
      syncOnchain();
      setTimeout(syncOnchain, 1200);
      setTimeout(syncOnchain, 3000);
      setTimeout(syncOnchain, 6000);
    }
  };

  // Send transfer completed
  const handleSendComplete = (tx: TransactionRecord) => {
    saveTransaction(tx);
    setTransactions((prev) => [tx, ...prev.filter((item) => item.id !== tx.id)]);
    showToast(`Successfully sent ${tx.amount} ${tx.tokenSymbol}!`);
  };

  // Payment completed
  const handlePaymentSuccess = async (receipt: CustomerPaymentReceipt) => {
    showToast(`Payment of ${receipt.amountPaid} ${receipt.tokenSymbol} confirmed!`);
    if (wallet?.address) {
      try {
        const freshBal = await fetchRealOnchainBalances(wallet.address);
        setTokens((prev) =>
          prev.map((t) => {
            const byId = freshBal.byTokenId?.[t.id];
            if (typeof byId === 'number') {
              return { ...t, balance: byId };
            }
            const netKey = `${t.network}:${t.symbol}`;
            const byNet = freshBal.byNetworkAndSymbol?.[netKey];
            if (typeof byNet === 'number') {
              return { ...t, balance: byNet };
            }
            const sym = t.symbol as keyof typeof freshBal;
            if (typeof freshBal[sym] === 'number') {
              return { ...t, balance: freshBal[sym] as number };
            }
            return t;
          })
        );

        setWallet((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tokens: {
              ...prev.tokens,
              POL: freshBal.POL,
              USDT: freshBal.USDT,
              USDC: freshBal.USDC,
              DAI: freshBal.DAI,
              WBTC: freshBal.WBTC,
              VERSE: freshBal.VERSE,
              ETH: freshBal.ETH,
              'polygon:VERSE': freshBal.byNetworkAndSymbol?.['polygon:VERSE'] ?? freshBal.VERSE,
              'ethereum:VERSE': freshBal.byNetworkAndSymbol?.['ethereum:VERSE'] ?? 0,
              'polygon:POL': freshBal.POL,
              'ethereum:ETH': freshBal.ETH,
            },
            tokenBalancesById: freshBal.byTokenId,
          };
        });
      } catch (e) {
        console.warn('Post-payment balance refresh notice:', e);
      }
    }
  };

  // Copy address feedback
  const handleCopyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    showToast('Wallet address copied to clipboard!');
  };

  return (
    <div
      className={`min-h-screen font-sans transition-colors duration-200 ${
        settings.theme === 'dark'
          ? 'bg-slate-950 text-slate-100'
          : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Toast notification banner */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-cyan-500 text-slate-950 font-bold text-xs shadow-2xl shadow-cyan-500/40 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-slate-950" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        wallet={wallet}
        tokens={tokens}
        totalPortfolioUsd={totalPortfolioUsd}
        settings={settings}
        onOpenConnectModal={handleOpenConnect}
        onOpenSettings={(tab) => {
          setSettingsInitialTab(tab || 'general');
          setIsSettingsOpen(true);
        }}
        onToggleTheme={() =>
          setSettings((prev) => ({
            ...prev,
            theme: prev.theme === 'dark' ? 'light' : 'dark',
          }))
        }
        selectedNetwork={selectedNetwork}
        onChangeNetwork={setSelectedNetwork}
        onDisconnectWallet={handleDisconnectWallet}
        onCopyAddress={handleCopyAddress}
      />

      {/* Main Workspace Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 pb-20 md:pb-10">
        {/* Landing Hero shown when wallet is disconnected and on swap tab */}
        {!wallet && activeTab === 'swap' && (
          <LandingHero
            tokens={tokens}
            currency={settings.currency}
            onConnectWallet={handleOpenConnect}
            onCreateWallet={() => setIsCreateWalletModalOpen(true)}
            onExploreDirectly={() => {}}
          />
        )}

        {/* SWAP TAB */}
        {activeTab === 'swap' && (
          <div className="space-y-8">
            <SwapCard
              tokens={tokens}
              wallet={wallet}
              settings={settings}
              onInitiateSwap={handleInitiateSwap}
              onOpenConnectModal={handleOpenConnect}
              onOpenTokenSelector={(target) => setTokenSelectorTarget(target)}
              fromToken={fromToken}
              toToken={toToken}
              onSwapPair={handleSwapPair}
              onOpenChart={() => setIsChartOpen(true)}
              lastCompletedSwapTimestamp={lastCompletedSwapTimestamp}
            />
          </div>
        )}

        {/* PAY MERCHANT TAB */}
        {activeTab === 'pay' && (
          <CustomerCheckout
            initialInvoiceId={payInvoiceId}
            wallet={wallet}
            tokens={tokens}
            settings={settings}
            onOpenConnectModal={handleOpenConnect}
            onPaymentSuccess={handlePaymentSuccess}
            onNavigateToMerchantHub={() => setActiveTab('merchant')}
            onDisconnectWallet={handleDisconnectWallet}
          />
        )}

        {/* MERCHANT HUB & POS TAB */}
        {activeTab === 'merchant' && (
          <MerchantHub
            wallet={wallet}
            tokens={tokens}
            settings={settings}
            onOpenConnectModal={handleOpenConnect}
            onOpenCustomerCheckoutWithInvoice={(invId) => {
              setPayInvoiceId(invId);
              setActiveTab('pay');
            }}
          />
        )}

        {/* PAYMENTS LEDGER TAB */}
        {activeTab === 'payments' && (
          <PaymentsDashboard
            wallet={wallet}
            tokens={tokens}
            settings={settings}
            onOpenConnectModal={handleOpenConnect}
            onOpenCheckout={(invId) => {
              setPayInvoiceId(invId || null);
              setActiveTab('pay');
            }}
            onOpenMerchantHub={() => setActiveTab('merchant')}
          />
        )}

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <HomeDashboard
            wallet={wallet}
            tokens={tokens}
            totalPortfolioUsd={totalPortfolioUsd}
            transactions={transactions}
            settings={settings}
            onNavigateTab={setActiveTab}
            onOpenSend={() => setIsSendModalOpen(true)}
            onOpenReceive={() => setIsReceiveModalOpen(true)}
            onOpenBuyCrypto={() => setIsFiatModalOpen(true)}
            onOpenConnectModal={handleOpenConnect}
            onDisconnectWallet={handleDisconnectWallet}
            onOpenExplorer={(tx) => {
              setInspectedTx(tx);
              setIsExplorerOpen(true);
            }}
            onSelectTokenToSwap={(t) => {
              setFromToken(t);
              const alt = tokens.find((tok) => tok.symbol !== t.symbol) || tokens[0];
              setToToken(alt);
            }}
          />
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <HistoryView
            transactions={transactions}
            settings={settings}
            walletAddress={currentWalletAddress}
            isWalletConnected={isTrulyConnected && Boolean(currentWalletAddress)}
            onConnectWallet={handleOpenConnect}
            onOpenExplorer={(tx) => {
              setInspectedTx(tx);
              setIsExplorerOpen(true);
            }}
            onDeleteTransaction={(id, hash) => {
              deleteTransaction(id, hash);
              if (currentWalletAddress) {
                setTransactions(getStoredTransactions(currentWalletAddress));
              } else {
                setTransactions([]);
              }
              showToast('Transaction removed from history.');
            }}
            onClearHistory={() => {
              clearAllTransactions();
              setTransactions([]);
              showToast('All transaction history cleared.');
            }}
          />
        )}

        {/* EARN TAB */}
        {activeTab === 'earn' && (
          <EarnModal
            wallet={wallet}
            settings={settings}
            onOpenConnectModal={handleOpenConnect}
          />
        )}

        {/* ADMIN TAB */}
        {activeTab === 'admin' && (
          <AdminDashboard
            onBackToApp={() => setActiveTab('dashboard')}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 p-2 flex items-center justify-around">
        <button
          onClick={() => setActiveTab('swap')}
          className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl text-[10px] font-bold transition-colors ${
            activeTab === 'swap' ? 'text-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>Swap</span>
        </button>
        <button
          onClick={() => setActiveTab('pay')}
          className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl text-[10px] font-bold transition-colors ${
            activeTab === 'pay' ? 'text-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Pay</span>
        </button>
        <button
          onClick={() => setActiveTab('merchant')}
          className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl text-[10px] font-bold transition-colors ${
            activeTab === 'merchant' ? 'text-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Store className="w-4 h-4" />
          <span>Merchant</span>
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl text-[10px] font-bold transition-colors ${
            activeTab === 'dashboard' ? 'text-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>Portfolio</span>
        </button>
      </div>

      {/* ================= MODALS & DRAWERS ================= */}

      {/* Token Selector Modal */}
      <TokenSelectorModal
        isOpen={tokenSelectorTarget !== null}
        onClose={() => setTokenSelectorTarget(null)}
        tokens={tokens}
        selectedToken={tokenSelectorTarget === 'from' ? fromToken : toToken}
        onSelectToken={(tok) => {
          if (tokenSelectorTarget === 'from') {
            if (tok.symbol === toToken.symbol) {
              setToToken(fromToken);
            }
            setFromToken(tok);
          } else {
            if (tok.symbol === fromToken.symbol) {
              setFromToken(toToken);
            }
            setToToken(tok);
          }
        }}
        currency={settings.currency}
      />

      {/* Unified Swap Confirmation & Execution Modal (Pops up only once) */}
      <SwapConfirmationModal
        isOpen={isConfirmationOpen}
        onClose={() => {
          isSwapBusyRef.current = false;
          setIsConfirmationOpen(false);
          setActiveQuote(null);
        }}
        quote={activeQuote}
        wallet={wallet}
        onComplete={handleProcessingComplete}
        settings={settings}
      />

      {/* Wallet Connect Modal */}
      <WalletConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onConnect={() => {
          setIsExplicitlyDisconnected(false);
          if (typeof window !== 'undefined') {
            localStorage.removeItem('payflux_explicitly_disconnected');
          }
        }}
        onCreateNewWallet={() => setIsCreateWalletModalOpen(true)}
        selectedNetwork={selectedNetwork}
        wallet={wallet}
        onDisconnect={handleDisconnectWallet}
      />

      {/* Create New Wallet Modal */}
      <CreateWalletModal
        isOpen={isCreateWalletModalOpen}
        onClose={() => setIsCreateWalletModalOpen(false)}
        onWalletCreated={(acct) => {
          setIsExplicitlyDisconnected(false);
          if (typeof window !== 'undefined') {
            localStorage.removeItem('payflux_explicitly_disconnected');
          }
          setWallet(acct);
          showToast('New non-custodial wallet created securely on device!');
        }}
        selectedNetwork={selectedNetwork}
      />

      {/* Send Modal */}
      {wallet && (
        <SendModal
          isOpen={isSendModalOpen}
          onClose={() => setIsSendModalOpen(false)}
          tokens={tokens}
          wallet={wallet}
          settings={settings}
          onSendComplete={handleSendComplete}
        />
      )}

      {/* Receive Modal */}
      {wallet && (
        <ReceiveModal
          isOpen={isReceiveModalOpen}
          onClose={() => setIsReceiveModalOpen(false)}
          tokens={tokens}
          wallet={wallet}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={(newSt) => setSettings((prev) => ({ ...prev, ...newSt }))}
        wallet={wallet}
        onDisconnectWallet={handleDisconnectWallet}
        onOpenConnectModal={handleOpenConnect}
        initialTab={settingsInitialTab}
      />

      {/* Fiat Onramp Modal */}
      <FiatOnrampModal
        isOpen={isFiatModalOpen}
        onClose={() => setIsFiatModalOpen(false)}
        tokens={tokens}
        wallet={wallet}
        settings={settings}
        onOpenConnectModal={handleOpenConnect}
      />

      {/* Explorer Modal */}
      <ExplorerModal
        isOpen={isExplorerOpen}
        onClose={() => setIsExplorerOpen(false)}
        tx={inspectedTx}
        settings={settings}
      />

      {/* Receipt Share Modal */}
      <ReceiptShareModal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        tx={receiptTx}
        settings={settings}
      />

      {/* Interactive Price Chart Drawer */}
      <ChartDrawer
        isOpen={isChartOpen}
        onClose={() => setIsChartOpen(false)}
        fromToken={fromToken}
        toToken={toToken}
        currency={settings.currency}
      />
    </div>
  );
}

