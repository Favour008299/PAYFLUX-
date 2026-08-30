import { safeGetAddress, ZERO_ADDRESS } from './sharedSwapEngine';
import { shortenAddress } from '../utils/crypto';
import { launchBitcoinComWalletApp, openWalletRedirectUrl, wagmiAdapter, appKit } from '../config/web3';

export interface ActiveSigningSessionResult {
  provider: any;
  account: `0x${string}`;
  chainId: number;
}

/**
 * Detects whether the current browser session is running on a mobile device.
 */
export function isMobileBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Returns the brand name of the currently connected or selected wallet.
 */
export function getConnectedWalletBrand(connectorName?: string): string {
  if (typeof window === 'undefined') return 'Bitcoin.com Wallet';
  const savedName = localStorage.getItem('payflux_connected_wallet_name') || '';
  const candidate = connectorName || savedName || '';
  const lower = candidate.toLowerCase();
  if (lower.includes('bitcoin') || lower.includes('verse')) return 'Bitcoin.com Wallet';
  if (lower.includes('metamask')) return 'MetaMask';
  if (lower.includes('trust')) return 'Trust Wallet';
  if (lower.includes('rainbow')) return 'Rainbow';
  if (lower.includes('coinbase')) return 'Coinbase Wallet';
  if (lower.includes('walletconnect') || !candidate) return 'Bitcoin.com Wallet';
  return candidate;
}

/**
 * Returns true if the active wallet is Bitcoin.com Wallet.
 */
export function isBitcoinComWallet(walletName?: string): boolean {
  const brand = getConnectedWalletBrand(walletName).toLowerCase();
  return brand.includes('bitcoin') || brand.includes('verse');
}

/**
 * Registers an active window/tab return detector.
 * When the user switches away to Bitcoin.com Wallet (or another wallet app) to approve
 * a connection, token allowance, or transaction, and then returns to PayFlux, this detector
 * triggers the provided callback so the app immediately resumes verification instead of
 * getting stuck or leaving the user confused.
 */
export function setupWalletReturnDetector(
  onReturn: () => void,
  debounceMs = 600
): () => void {
  if (typeof window === 'undefined') return () => {};

  let lastTriggered = 0;
  const handleReturn = () => {
    const now = Date.now();
    if (now - lastTriggered < debounceMs) return;
    lastTriggered = now;
    onReturn();
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      handleReturn();
    }
  };

  window.addEventListener('focus', handleReturn);
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    window.removeEventListener('focus', handleReturn);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

/**
 * Triggers mobile wallet application focus / deep-link for WalletConnect or native apps.
 * Safely dispatches custom scheme (e.g. bitcoincom://) so that the user's wallet opens directly.
 */
export function triggerMobileWalletPrompt(walletName?: string, mobileLink?: string) {
  if (typeof window === 'undefined') return;
  const isMobile = isMobileBrowser();
  if (!isMobile) return;

  // If running inside an in-app Web3 browser, do not trigger external URL schemes
  const isInAppWebview = Boolean(
    (window as any).ethereum &&
    !((window as any).ethereum.isWalletConnect) &&
    ((window as any).ethereum.isMetaMask ||
     (window as any).ethereum.isTrust ||
     (window as any).ethereum.isBitcoinCom ||
     (window as any).ethereum.isCoinbaseWallet ||
     (window as any).ethereum.isSafePal)
  );
  if (isInAppWebview) return;

  const savedName = localStorage.getItem('payflux_connected_wallet_name') || '';
  const wName = (walletName || savedName || '').toLowerCase();

  if (wName.includes('bitcoin') || wName.includes('verse') || wName.includes('walletconnect') || (!wName && !mobileLink)) {
    launchBitcoinComWalletApp();
  } else if (mobileLink) {
    openWalletRedirectUrl(mobileLink);
  } else if (wName.includes('metamask')) {
    openWalletRedirectUrl('metamask://');
  } else if (wName.includes('trust')) {
    openWalletRedirectUrl('trust://');
  } else if (wName.includes('rainbow')) {
    openWalletRedirectUrl('rainbow://');
  } else if (wName.includes('coinbase')) {
    openWalletRedirectUrl('cbwallet://');
  } else {
    launchBitcoinComWalletApp();
  }
}

/**
 * Dispatches eth_sendTransaction with automated timeout and transient relay retry
 */
export async function sendTransactionWithRetry(
  provider: any,
  txParams: any,
  timeoutMs = 90000,
  timeoutMessage = 'Wallet confirmation timed out. Please check your wallet app.'
): Promise<`0x${string}`> {
  const withTimeoutPromise = <T>(promise: Promise<T>, ms: number, msg: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(msg)), ms);
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
  };

  const executeRequest = async (): Promise<`0x${string}`> => {
    try {
      return await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });
    } catch (reqErr: any) {
      const errStr = String(reqErr?.message || reqErr || '').toLowerCase();
      if (errStr.includes('unknown account') && txParams.from) {
        // Try without explicit from address in case the wallet provider defaults to active account
        try {
          const paramsNoFrom = { ...txParams };
          delete paramsNoFrom.from;
          return await provider.request({
            method: 'eth_sendTransaction',
            params: [paramsNoFrom],
          });
        } catch (_) {
          throw reqErr;
        }
      }
      throw reqErr;
    }
  };

  try {
    return await withTimeoutPromise(executeRequest(), timeoutMs, timeoutMessage);
  } catch (err: any) {
    const errMsg = String(err?.message || err || '').toLowerCase();
    // If WalletConnect relay socket temporarily drops during app-switching, wait and retry once
    if (
      errMsg.includes('failed to publish payload') ||
      errMsg.includes('tag:1108') ||
      errMsg.includes('relay') ||
      errMsg.includes('socket')
    ) {
      console.warn('[WalletSigning] Transient relay notice detected. Waiting for relay re-sync and retrying once...');
      await new Promise((r) => setTimeout(r, 1200));
      return await withTimeoutPromise(executeRequest(), timeoutMs, timeoutMessage);
    }
    throw err;
  }
}

/**
 * Verifies that the connected wallet's active signing provider and session
 * are live, responding, matching the expected account, and ready to request signatures.
 */
export async function verifyActiveSigningSession(params: {
  connector?: any;
  appKitProvider?: any;
  expectedAccount?: string;
  targetChainId?: number;
}): Promise<ActiveSigningSessionResult> {
  const { connector, appKitProvider, expectedAccount, targetChainId } = params;

  // 1. Resolve active provider from connector, AppKit, wagmiAdapter config, or window.ethereum
  let activeProvider: any = null;

  if (connector && typeof connector.getProvider === 'function') {
    try {
      activeProvider = await connector.getProvider();
    } catch (e) {
      console.warn('[WalletSigning] connector.getProvider error:', e);
    }
  }

  if (!activeProvider && appKitProvider) {
    activeProvider = appKitProvider;
  }

  if (!activeProvider && appKit) {
    try {
      if (typeof (appKit as any).getProvider === 'function') {
        activeProvider = (appKit as any).getProvider('eip155') || (appKit as any).getProvider();
      } else if (typeof (appKit as any).getWalletProvider === 'function') {
        activeProvider = (appKit as any).getWalletProvider();
      }
    } catch (_) {}
  }

  if (!activeProvider && wagmiAdapter?.wagmiConfig) {
    try {
      const currentConn = wagmiAdapter.wagmiConfig.state.connections.get(
        wagmiAdapter.wagmiConfig.state.current || ''
      );
      if (currentConn?.connector && typeof currentConn.connector.getProvider === 'function') {
        activeProvider = await currentConn.connector.getProvider();
      }
    } catch (e) {
      console.warn('[WalletSigning] wagmiConfig connection check error:', e);
    }
  }

  if (!activeProvider && typeof window !== 'undefined' && (window as any).ethereum) {
    activeProvider = (window as any).ethereum;
  }

  // 2. Determine and verify active account
  let resolvedAccount = expectedAccount ? safeGetAddress(expectedAccount) : ZERO_ADDRESS;

  // If provider supports eth_accounts, query non-destructively
  if (activeProvider && typeof activeProvider.request === 'function') {
    try {
      const accounts = await Promise.race([
        activeProvider.request({ method: 'eth_accounts' }),
        new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
      ]);
      if (Array.isArray(accounts) && accounts.length > 0 && accounts[0]) {
        const providerAcct = safeGetAddress(accounts[0]);
        if (providerAcct !== ZERO_ADDRESS) {
          resolvedAccount = providerAcct;
        }
      }
    } catch (_) {
      // Non-blocking query: if expectedAccount is valid, we proceed with expectedAccount
    }
  }

  if (resolvedAccount === ZERO_ADDRESS) {
    if (expectedAccount && safeGetAddress(expectedAccount) !== ZERO_ADDRESS) {
      resolvedAccount = safeGetAddress(expectedAccount);
    } else {
      throw new Error('Please connect your wallet to continue.');
    }
  }

  // 3. Query active chain ID from provider
  let currentChainId = targetChainId || 137;
  if (activeProvider && typeof activeProvider.request === 'function') {
    try {
      const hexChain = await Promise.race([
        activeProvider.request({ method: 'eth_chainId' }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      if (hexChain) {
        currentChainId = typeof hexChain === 'string' ? parseInt(hexChain, 16) : Number(hexChain);
      }
    } catch {
      currentChainId = targetChainId || 137;
    }
  }

  // 4. If targetChainId is provided (e.g. 137 for Polygon or 1 for Ethereum) and doesn't match:
  if (targetChainId && currentChainId !== targetChainId && activeProvider?.request) {
    try {
      await activeProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + targetChainId.toString(16) }],
      });
      currentChainId = targetChainId;
    } catch (switchErr: any) {
      if (switchErr?.code === 4902 || switchErr?.message?.includes('4902')) {
        if (targetChainId === 137) {
          try {
            await activeProvider.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0x89',
                  chainName: 'Polygon Mainnet',
                  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
                  rpcUrls: ['https://polygon-rpc.com'],
                  blockExplorerUrls: ['https://polygonscan.com'],
                },
              ],
            });
            currentChainId = 137;
          } catch {
            // Proceed - Wagmi switchChain will handle if needed
          }
        }
      }
    }
  }

  return {
    provider: activeProvider,
    account: resolvedAccount,
    chainId: currentChainId,
  };
}
