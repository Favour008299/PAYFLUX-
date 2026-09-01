import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { polygon, mainnet, bsc, avalanche, arbitrum, optimism, base } from '@reown/appkit/networks';
import { QueryClient } from '@tanstack/react-query';

// Statically import AppKit UI components to prevent dynamic Vite lazy module fetch failures
import '@reown/appkit-ui';
import '@reown/appkit-scaffold-ui';
import '@reown/appkit-scaffold-ui/w3m-modal';

// Ensure BigInt values can be safely serialized anywhere in the app/libraries
if (typeof BigInt !== 'undefined' && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

import {
  CoreHelperUtil,
  ConnectionController,
  RouterController,
  OptionsController,
  ModalController
} from '@reown/appkit-controllers';

// Project ID resolution: user localStorage override -> Vite env variable -> default projectId
export const getActiveProjectId = (): string => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('verseswap_wc_project_id');
    if (saved && saved.trim().length >= 20) {
      return saved.trim();
    }
  }
  return ((import.meta as any)?.env?.VITE_WALLETCONNECT_PROJECT_ID as string) || '1719c40614624ba8e3aa822db13c631d';
};

export const projectId = getActiveProjectId();

// Intercept noisy relay socket logs & internal pino log packets from WalletConnect core in sandboxed environments
if (typeof window !== 'undefined') {
  const isRelayNoise = (item: any): boolean => {
    if (!item) return false;
    if (typeof item === 'string') {
      const lower = item.toLowerCase();
      return (
        lower.includes('onrelaymessage') ||
        lower.includes('failed to process an inbound message') ||
        lower.includes('relay.walletconnect.org') ||
        lower.includes('relay.walletconnect.com') ||
        lower.includes('socket connection to the relay server') ||
        lower.includes('websocket connection to') ||
        lower.includes('wss://relay') ||
        lower.includes('failed to publish payload') ||
        lower.includes('failed to subscribe') ||
        lower.includes('core/publisher') ||
        lower.includes('core/relayer') ||
        lower.includes('core/crypto') ||
        lower.includes('core/pairing') ||
        lower.includes('core/messages') ||
        lower.includes('core/history') ||
        lower.includes('missing or invalid') ||
        lower.includes('subscription expired') ||
        lower.includes('no matching key') ||
        lower.includes('apkt003') ||
        lower.includes('base account') ||
        lower.includes('coinbase wallet sdk') ||
        lower.includes('failed to import base account sdk') ||
        lower.includes('failed to load the embedded wallet') ||
        lower.includes('embedded wallet') ||
        lower.includes('auth.web3modal') ||
        lower.includes('auth.reown') ||
        lower.includes('error injecting modal ui') ||
        lower.includes('failed to fetch dynamically imported module') ||
        lower.includes('w3m-modal') ||
        lower.includes('cross-origin-opener-policy') ||
        lower.includes('cross_origin_opener_policy') ||
        lower.includes('coop') ||
        lower.includes('could not reach cloud firestore backend') ||
        lower.includes('client will operate in offline mode') ||
        item.includes('"level":50') ||
        item.includes('"level":40') ||
        item.includes('"level":30')
      );
    }
    if (typeof item === 'object') {
      // WalletConnect internal Pino logger format: { time: number, level: number, msg?: string, ... }
      if (typeof item.time === 'number' && typeof item.level === 'number') {
        return true;
      }
      if (
        item.context &&
        typeof item.context === 'string' &&
        (item.context.includes('core') || item.context.includes('relay') || item.context.includes('crypto'))
      ) {
        return true;
      }
      if (item.msg && (typeof item.msg === 'string' ? isRelayNoise(item.msg) : true)) {
        if (typeof item.msg === 'string' && isRelayNoise(item.msg)) return true;
      }
      if (item.message && typeof item.message === 'string' && isRelayNoise(item.message)) {
        return true;
      }
      try {
        const str = JSON.stringify(item, (_key, val) =>
          typeof val === 'bigint' ? val.toString() : val
        );
        return isRelayNoise(str);
      } catch (_) {}
    }
    return false;
  };

  const origError = console.error.bind(console);
  console.error = (...args: any[]) => {
    const isRelay = args.some(isRelayNoise);
    if (isRelay) {
      // Non-fatal background relay socket retry in sandboxed environment
      return;
    }
    origError(...args);
  };

  const origWarn = console.warn.bind(console);
  console.warn = (...args: any[]) => {
    const isRelay = args.some(isRelayNoise);
    if (isRelay) {
      return;
    }
    origWarn(...args);
  };

  // Prevent transient WebSocket connection exceptions from bubbling up as uncaught errors
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && isRelayNoise(event.reason)) {
      event.preventDefault();
    }
  });
}

export const queryClient = new QueryClient();

export const networks = [polygon, mainnet, bsc, avalanche, arbitrum, optimism, base] as const;

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [polygon, mainnet, bsc, avalanche, arbitrum, optimism, base],
});

export const appKitMetadata = {
  name: 'PayFlux',
  description: 'PayFlux – Swap Crypto in Seconds with Non-Custodial Multi-Chain Liquidity and Payment Hub',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://payflux.app',
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
  redirect: {
    native: 'payflux://',
    universal: typeof window !== 'undefined' ? window.location.origin : 'https://payflux.app',
  },
};

/**
 * Global helper to safely dispatch wallet app custom schemes (e.g. bitcoincom://wc?uri=...).
 * Strictly dispatches via detached hidden DOM elements to avoid navigating the window location
 * and prevents net::ERR_BLOCKED_BY_RESPONSE or net::ERR_UNKNOWN_URL_SCHEME.
 */
export function openWalletRedirectUrl(url: string, _target?: string) {
  if (!url || typeof window === 'undefined') return;

  // Never use raw intent:// URLs as they trigger net::ERR_UNKNOWN_URL_SCHEME in mobile browsers
  if (url.startsWith('intent:')) {
    const schemeMatch = url.match(/scheme=([^;]+)/);
    const uriMatch = url.match(/uri=([^#;]+)/);
    if (schemeMatch && schemeMatch[1]) {
      const scheme = schemeMatch[1];
      const uri = uriMatch ? uriMatch[1] : '';
      url = uri ? `${scheme}://wc?uri=${uri}` : `${scheme}://`;
    } else {
      return;
    }
  }

  // Never navigate the window to wallet.bitcoin.com web URL which triggers ERR_BLOCKED_BY_RESPONSE in webviews
  if (url.includes('wallet.bitcoin.com') || url.includes('bitcoin.com/wc')) {
    const uriMatch = url.match(/uri=([^&]+)/);
    if (uriMatch && uriMatch[1]) {
      url = `bitcoincom://wc?uri=${uriMatch[1]}`;
    } else {
      url = 'bitcoincom://';
    }
  }

  try {
    const isCustomScheme = !url.startsWith('http://') && !url.startsWith('https://');
    if (isCustomScheme) {
      // Safe custom scheme dispatch via hidden anchor click without replacing current document
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noreferrer noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          if (a.parentNode) {
            a.parentNode.removeChild(a);
          }
        } catch (_) {}
      }, 300);
    }
  } catch (e) {
    console.warn('[Web3 Auto-Redirect] redirect error:', e);
  }
}

/**
 * Direct helper specifically for Bitcoin.com Wallet App using registered custom scheme.
 * Custom Scheme: bitcoincom://wc?uri=...
 */
export function launchBitcoinComWalletApp(wcUri?: string) {
  if (typeof window === 'undefined') return;

  if (wcUri) {
    const encodedWc = encodeURIComponent(wcUri);
    openWalletRedirectUrl(`bitcoincom://wc?uri=${encodedWc}`);
  } else {
    openWalletRedirectUrl('bitcoincom://');
  }
}

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: [polygon, mainnet, bsc, avalanche, arbitrum, optimism, base],
  projectId,
  metadata: appKitMetadata,
  featuredWalletIds: [
    'c286eebc74384d7d6b38c23ac681cf4aa3b290372df03d42e20ffba244f77c8e', // Bitcoin.com Wallet
    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
  ],
  features: {
    analytics: false,
    allWallets: true,
    email: false,
    socials: false,
    emailShowWallets: false,
    swaps: false,
    onramp: false,
    history: false,
  },
  enableWalletConnect: true,
  enableInjected: true,
  enableCoinbase: false,
  enableBaseAccount: false,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#06b6d4',
    '--w3m-border-radius-master': '16px',
    '--w3m-z-index': 99999,
  },
});

// Defensive patch for AppKit handleAlertError bug where error without string .message property crashes
if (typeof window !== 'undefined' && appKit) {
  try {
    const origHandleAlertError = (appKit as any).handleAlertError;
    if (typeof origHandleAlertError === 'function') {
      (appKit as any).handleAlertError = function (error: any) {
        if (!error || typeof error.message !== 'string') return;
        try {
          return origHandleAlertError.call(this, error);
        } catch (_) {}
      };
    }
  } catch (_) {}
}

// Setup automatic watcher for Bitcoin.com and mobile wallet views to cleanly redirect
if (typeof window !== 'undefined') {
  let lastRedirectedUri = '';

  const triggerAutoRedirectIfConnecting = () => {
    try {
      const currentView = RouterController?.state?.view;
      const isConnectingView =
        currentView === 'ConnectingWalletConnect' ||
        currentView === 'ConnectingWalletConnectBasic' ||
        currentView === 'ConnectingExternal';

      const wcUri = ConnectionController?.state?.wcUri;
      const walletData = RouterController?.state?.data?.wallet;
      const walletName = (walletData?.name || '').toLowerCase();
      const isBitcoinCom =
        walletName.includes('bitcoin') ||
        walletName.includes('verse') ||
        walletData?.mobile_link?.includes('bitcoincom') ||
        walletData?.id === 'c286eebc74384d7d6b38c23ac681cf4aa3b290372df03d42e20ffba244f77c8e';

      if (isConnectingView && wcUri && wcUri !== lastRedirectedUri) {
        lastRedirectedUri = wcUri;

        if (isBitcoinCom) {
          launchBitcoinComWalletApp(wcUri);
        } else if (walletData?.mobile_link) {
          const formatted = CoreHelperUtil?.formatNativeUrl
            ? CoreHelperUtil.formatNativeUrl(walletData.mobile_link, wcUri)
            : null;
          const targetUrl = formatted?.redirect || formatted?.redirectUniversalLink || `wc:${wcUri}`;
          openWalletRedirectUrl(targetUrl);
        }
      }
    } catch (err) {
      console.warn('[Web3 Auto-Redirect] watcher error:', err);
    }
  };

  // Subscribe to URI generation & Router view changes
  if (ConnectionController && typeof ConnectionController.subscribeKey === 'function') {
    ConnectionController.subscribeKey('wcUri', () => {
      triggerAutoRedirectIfConnecting();
    });
  }

  if (RouterController && typeof RouterController.subscribeKey === 'function') {
    RouterController.subscribeKey('view', () => {
      setTimeout(triggerAutoRedirectIfConnecting, 80);
    });
  }
}

/**
 * Robust disconnect helper that terminates active WalletConnect & AppKit connections,
 * clears storage keys, closes open modals, and resets controllers for clean reconnection.
 */
export async function disconnectWalletSession(): Promise<void> {
  // 1. Disconnect Wagmi connectors & clear Wagmi state
  try {
    const wagmiConfig = wagmiAdapter?.wagmiConfig;
    if (wagmiConfig) {
      const connectors = wagmiConfig.connectors || [];
      for (const connector of connectors) {
        try {
          if (typeof connector.disconnect === 'function') {
            await connector.disconnect();
          }
        } catch (_) {}
      }
      try {
        wagmiConfig.setState((state: any) => ({
          ...state,
          connections: new Map(),
          current: null,
          status: 'disconnected',
        }));
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[Web3] wagmi disconnect error:', err);
  }

  // 2. Disconnect AppKit
  try {
    if (appKit && typeof (appKit as any).disconnect === 'function') {
      await (appKit as any).disconnect();
    }
  } catch (err) {
    console.warn('[Web3] appKit.disconnect error:', err);
  }

  // 3. Reset ConnectionController
  try {
    if (ConnectionController && typeof ConnectionController.disconnect === 'function') {
      await ConnectionController.disconnect();
    }
  } catch (err) {
    console.warn('[Web3] ConnectionController.disconnect error:', err);
  }

  try {
    if (ConnectionController && typeof ConnectionController.resetWcConnection === 'function') {
      ConnectionController.resetWcConnection();
    }
  } catch (_) {}

  // 4. Close any open modal
  try {
    if (ModalController && typeof ModalController.close === 'function') {
      ModalController.close();
    }
  } catch (_) {}

  // 5. Thoroughly purge all cached wallet sessions from storage
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('verseswap_wallet');
      localStorage.removeItem('payflux_wallet');
      localStorage.removeItem('payflux_connected_wallet_name');
      localStorage.removeItem('wagmi.connected');
      localStorage.removeItem('wagmi.recentConnectorId');
      localStorage.removeItem('wagmi.store');
      localStorage.removeItem('wagmi.wallet');
      localStorage.removeItem('WALLETCONNECT_DEEPLINK_CHOICE');
      sessionStorage.removeItem('wagmi.connected');

      const keysToPurge: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith('@w3m') ||
            key.startsWith('@appkit') ||
            key.startsWith('wc@2') ||
            key.startsWith('wagmi') ||
            key.toLowerCase().includes('walletconnect'))
        ) {
          keysToPurge.push(key);
        }
      }
      keysToPurge.forEach((k) => {
        try {
          localStorage.removeItem(k);
        } catch (_) {}
      });
    } catch (_) {}
  }
}

/**
 * Universal hook to interact with AppKit modals safely without relying on internal React controller dispatcher
 */
export function useAppKit() {
  return {
    open: async (options?: { view?: 'Connect' | 'Account' | 'AllWallets' | 'Networks' | 'WhatIsAWallet' }) => {
      try {
        if (appKit && typeof appKit.open === 'function') {
          return await appKit.open(options);
        }
      } catch (e) {
        console.warn('[PayFlux AppKit] open error:', e);
      }
    },
    close: async () => {
      try {
        if (appKit && typeof appKit.close === 'function') {
          return await appKit.close();
        }
      } catch (_) {}
    },
  };
}

export function openAppKitModal(view: 'Connect' | 'Account' | 'AllWallets' | 'Networks' = 'Connect') {
  try {
    if (appKit && typeof appKit.open === 'function') {
      return appKit.open({ view });
    }
  } catch (e) {
    console.warn('[PayFlux AppKit] open error:', e);
  }
}

export function closeAppKitModal() {
  try {
    if (appKit && typeof appKit.close === 'function') {
      return appKit.close();
    }
  } catch (_) {}
}


