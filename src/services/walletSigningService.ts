import { safeGetAddress, ZERO_ADDRESS } from './sharedSwapEngine';
import { shortenAddress } from '../utils/crypto';
import { launchBitcoinComWalletApp, openWalletRedirectUrl, wagmiAdapter, appKit } from '../config/web3';

export interface ActiveSigningSessionResult {
  provider: any;
  account: `0x${string}`;
  chainId: number;
}

/**
 * Triggers mobile wallet application focus / deep-link for WalletConnect or native apps.
 * Only triggers if not already inside an in-app Web3 browser.
 */
export function triggerMobileWalletPrompt(walletName?: string, mobileLink?: string) {
  if (typeof window === 'undefined') return;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
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

  if (wName.includes('bitcoin') || wName.includes('verse') || (!wName && !mobileLink)) {
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
 * 
 * If the session is unavailable or expired, throws:
 * "Wallet connection expired. Please reconnect your wallet."
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

  if (!activeProvider || typeof activeProvider.request !== 'function') {
    throw new Error('Wallet connection expired. Please reconnect your wallet.');
  }

  // 2. Query connected accounts directly from the active provider with 5s timeout
  let accounts: string[] = [];
  try {
    accounts = await new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Wallet connection expired. Please reconnect your wallet.'));
      }, 5000);

      activeProvider
        .request({ method: 'eth_accounts' })
        .then((res: any) => {
          clearTimeout(timeout);
          resolve(Array.isArray(res) ? res : []);
        })
        .catch((err: any) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  } catch {
    throw new Error('Wallet connection expired. Please reconnect your wallet.');
  }

  if (!accounts || accounts.length === 0) {
    throw new Error('Wallet connection expired. Please reconnect your wallet.');
  }

  const activeAccount = safeGetAddress(accounts[0]);
  if (activeAccount === ZERO_ADDRESS) {
    throw new Error('Wallet connection expired. Please reconnect your wallet.');
  }

  // Verify account matches the connected account shown in PayFlux
  if (expectedAccount) {
    const expected = safeGetAddress(expectedAccount);
    if (expected !== ZERO_ADDRESS && expected.toLowerCase() !== activeAccount.toLowerCase()) {
      throw new Error(`Connected wallet account mismatch (${shortenAddress(activeAccount)} vs ${shortenAddress(expected)}). Please reconnect your wallet.`);
    }
  }

  // 3. Query active chain ID from provider
  let currentChainId = 137;
  try {
    const hexChain = await activeProvider.request({ method: 'eth_chainId' });
    currentChainId = typeof hexChain === 'string' ? parseInt(hexChain, 16) : Number(hexChain);
  } catch {
    currentChainId = targetChainId || 137;
  }

  // 4. If targetChainId is provided (e.g. 137 for Polygon or 1 for Ethereum) and doesn't match:
  if (targetChainId && currentChainId !== targetChainId) {
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
            throw new Error('Please switch your wallet network to Polygon (Chain ID: 137) to continue.');
          }
        }
      } else {
        const errStr = (switchErr?.message || '').toLowerCase();
        if (errStr.includes('reject') || errStr.includes('denied')) {
          throw new Error(`Please switch your wallet network to ${targetChainId === 1 ? 'Ethereum' : 'Polygon'} (Chain ID: ${targetChainId}) in your wallet.`);
        }
      }
    }
  }

  return {
    provider: activeProvider,
    account: activeAccount,
    chainId: currentChainId,
  };
}
