import React, { useState, useEffect, useMemo } from 'react';
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

import { useAccount, useDisconnect as useWagmiDisconnect, useBalance, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { disconnectWalletSession, wagmiAdapter } from './config/web3';
import { useAppKit } from './hooks/useAppKit';
import { triggerOpenInstallModal } from './hooks/usePwaInstall';

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
import { SwapProcessingModal } from './components/SwapProcessingModal';
import { SwapSuccessModal } from './components/SwapSuccessModal';
import { WalletConnectModal } from './components/WalletConnectModal';
import { CreateWalletModal } from './components/CreateWalletModal';
import { SendModal } from './components/SendModal';
import { ReceiveModal } from './components/ReceiveModal';
import { SettingsModal } from './components/SettingsModal';
import { FiatOnrampModal } from './components/FiatOnrampModal';
import { ExplorerModal } from './components/ExplorerModal';
import { ReceiptShareModal } from './components/ReceiptShareModal';
import { ChartDrawer } from './components/ChartDrawer';
import { PwaInstallBanner } from './components/PwaInstallBanner';

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

  // Real WalletConnect & Wagmi Hooks
  const { open } = useAppKit();
  const { address: wagmiAddress, isConnected: wagmiConnected, connector } = useAccount();
  const chainId = useChainId();
  const { disconnectAsync: wagmiDisconnectAsync } = useWagmiDisconnect();

  const [isExplicitlyDisconnected, setIsExplicitlyDisconnected] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('payflux_explicitly_disconnected') === 'true';
    }
    return false;
  });

  // Active address & verified live connection boolean
  const activeAddress = wagmiAddress as `0x${string}` | undefined;
  const isTrulyConnected = Boolean(wagmiConnected && activeAddress && !isExplicitlyDisconnected);

  // When a wallet is genuinely connected via Wagmi, clear disconnected override so it stays connected
  useEffect(() => {
    if (wagmiConnected && activeAddress) {
      setIsExplicitlyDisconnected(false);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('payflux_explicitly_disconnected');
      }
    }
  }, [wagmiConnected, activeAddress]);

  const { data: realBalance } = useBalance({
    address: isTrulyConnected ? activeAddress : undefined,
  });

  // Core App Data & State
  const [tokens, setTokens] = useState<Token[]>(INITIAL_TOKENS);
  const [transactions, setTransactions] = useState<TransactionRecord[]>(INITIAL_TRANSACTIONS);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkType>('polygon');

  // Wallet State - Only populated when an active live session exists
  const [wallet, setWallet] = useState<WalletAccount | null>(null);

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
  const [isProcessingOpen, setIsProcessingOpen] = useState(false);
  const [completedTx, setCompletedTx] = useState<TransactionRecord | null>(null);
  const [isSuccessOpen, setIsSuccessOpen] = useState(false);
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFiatModalOpen, setIsFiatModalOpen] = useState(false);
  const [inspectedTx, setInspectedTx] = useState<TransactionRecord | null>(null);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [receiptTx, setReceiptTx] = useState<TransactionRecord | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isChartOpen, setIsChartOpen] = useState(false);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Synchronize real WalletConnect connection to app state
  useEffect(() => {
    if (!isTrulyConnected || !activeAddress) {
      setWallet(null);
      setTokens((prev) => prev.map((t) => (t.balance > 0 ? { ...t, balance: 0 } : t)));
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

    showToast('Wallet disconnected');
  };

  // Token Flip handler
  const handleSwapPair = () => {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
  };

  // Initiate Swap Flow
  const handleInitiateSwap = (quote: SwapQuote) => {
    if (!isTrulyConnected || !wallet || !activeAddress) {
      showToast('Please connect an active wallet to execute swap');
      handleOpenConnect();
      return;
    }
    setActiveQuote(quote);
    setIsConfirmationOpen(true);
  };

  // Confirm Swap -> Open Processing
  const handleConfirmSwap = () => {
    setIsConfirmationOpen(false);
    setIsProcessingOpen(true);
  };

  // Processing Completed -> Deduct balances & show Success
  const handleProcessingComplete = async (txData: Partial<TransactionRecord>) => {
    if (!activeQuote) return;

    const txHash = txData.hash || generateTxHash();
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
      timestamp: Date.now(),
      status: 'completed',
      networkFeeUsd: activeQuote.networkFeeUsd,
      blockNumber: blockNum,
      explorerUrl: expUrl,
      network: activeQuote.fromToken.network,
      orderId: txData.orderId || activeQuote.orderId,
    };

    setTransactions((prev) => [newTx, ...prev]);
    setCompletedTx(newTx);
    setIsProcessingOpen(false);
    setIsSuccessOpen(true);

    // Refresh real balances from on-chain immediately after confirmation
    if (wallet?.address) {
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
    }
  };

  // Send transfer completed
  const handleSendComplete = (tx: TransactionRecord) => {
    setTransactions((prev) => [tx, ...prev]);
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

      {/* PWA Update Banner & Floating Prompt */}
      <PwaInstallBanner mode="floating" />

      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        wallet={wallet}
        tokens={tokens}
        totalPortfolioUsd={totalPortfolioUsd}
        settings={settings}
        onOpenConnectModal={handleOpenConnect}
        onOpenSettings={() => setIsSettingsOpen(true)}
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
            onOpenExplorer={(tx) => {
              setInspectedTx(tx);
              setIsExplorerOpen(true);
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
          onClick={() => setActiveTab('payments')}
          className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl text-[10px] font-bold transition-colors ${
            activeTab === 'payments' ? 'text-cyan-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Ledger</span>
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
        <button
          id="btn-mobile-bottom-install"
          onClick={() => triggerOpenInstallModal()}
          className="flex flex-col items-center gap-0.5 p-1.5 rounded-xl text-[10px] font-bold text-cyan-300 hover:text-white transition-colors"
        >
          <Download className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span>Install</span>
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

      {/* Swap Confirmation Modal */}
      <SwapConfirmationModal
        isOpen={isConfirmationOpen}
        onClose={() => setIsConfirmationOpen(false)}
        quote={activeQuote}
        onConfirm={handleConfirmSwap}
        settings={settings}
      />

      {/* Swap Processing Multi-stage State */}
      <SwapProcessingModal
        isOpen={isProcessingOpen}
        quote={activeQuote}
        onComplete={handleProcessingComplete}
        onClose={() => setIsProcessingOpen(false)}
      />

      {/* Swap Success Modal with Receipt */}
      <SwapSuccessModal
        isOpen={isSuccessOpen}
        onClose={() => setIsSuccessOpen(false)}
        tx={completedTx}
        onOpenExplorer={(tx) => {
          setInspectedTx(tx);
          setIsExplorerOpen(true);
        }}
        onShareReceipt={(tx) => {
          setReceiptTx(tx);
          setIsReceiptModalOpen(true);
        }}
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

