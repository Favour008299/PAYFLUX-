import { safeGetAddress, ZERO_ADDRESS } from './sharedSwapEngine';
import { shortenAddress } from '../utils/crypto';
import { launchBitcoinComWalletApp, openWalletRedirectUrl } from '../config/web3';

export interface ActiveSigningSessionResult {
  provider: any;
  account: `0x${string}`;
  chainId: number;
}

/**
 * Triggers mobile wallet application focus / deep-link for WalletConnect or native apps
 */
export function triggerMobileWalletPrompt(walletName?: string, mobileLink?: string) {
  if (typeof window === 'undefined') return;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) return;

  const wName = (walletName || '').toLowerCase();
  if (wName.includes('bitcoin') || wName.includes('verse')) {
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

  // 1. Resolve active provider from connector, AppKit, or window.ethereum
  let activeProvider: any = null;
  if (connector) {
    try {
      activeProvider = await connector.getProvider();
    } catch (e) {
      console.warn('[WalletSigning] connector.getProvider error:', e);
    }
  }
  if (!activeProvider && appKitProvider) {
    activeProvider = appKitProvider;
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
