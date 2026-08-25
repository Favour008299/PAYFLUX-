import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { polygon, mainnet, bsc, avalanche, arbitrum, optimism, base } from '@reown/appkit/networks';
import { QueryClient } from '@tanstack/react-query';

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
};

// Global helper to safely and immediately trigger wallet app redirects directly to native mobile apps
export function openWalletRedirectUrl(url: string, target?: string) {
  if (!url || typeof window === 'undefined') return;

  // Filter out any web marketing URLs so user is never redirected to a website
  if (url.includes('wallet.bitcoin.com') || url.includes('bitcoin.com/')) {
    return;
  }

  const isCustomScheme = !url.startsWith('http://') && !url.startsWith('https://');

  // 1. Direct location change for custom schemes & deep links
  try {
    window.location.href = url;
  } catch (e) {
    console.warn('[Web3 Auto-Redirect] direct location navigation:', e);
  }

  // 2. Hidden anchor click for Android intent / iframe dispatch
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = target || '_self';
    a.rel = 'noreferrer noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        if (a.parentNode) {
          a.parentNode.removeChild(a);
        }
      } catch (_) {}
    }, 200);
  } catch (_) {}
}

// Direct helper specifically for Bitcoin.com Wallet App on Android and iOS
export function launchBitcoinComWalletApp(wcUri?: string) {
  if (typeof window === 'undefined') return;

  const isAndroid = /Android/i.test(navigator.userAgent);

  if (wcUri) {
    const encodedWc = encodeURIComponent(wcUri);
    if (isAndroid) {
      // Direct Android package intent to launch Bitcoin.com Wallet app without browser intervention
      const androidIntent = `intent://wc?uri=${encodedWc}#Intent;scheme=bitcoincom;package=com.bitcoin.mwallet;end;`;
      openWalletRedirectUrl(androidIntent);
      
      // Immediate backup custom scheme
      setTimeout(() => {
        openWalletRedirectUrl(`bitcoincom://wc?uri=${encodedWc}`);
      }, 250);
    } else {
      // iOS / other mobile custom scheme
      openWalletRedirectUrl(`bitcoincom://wc?uri=${encodedWc}`);
    }
  } else {
    // Launch app root if no URI yet
    if (isAndroid) {
      openWalletRedirectUrl('intent://#Intent;scheme=bitcoincom;package=com.bitcoin.mwallet;end;');
    }
    openWalletRedirectUrl('bitcoincom://');
  }
}

// Intercept and patch CoreHelperUtil.openHref so that all AppKit deep link buttons trigger reliably
if (typeof window !== 'undefined' && CoreHelperUtil) {
  try {
    const originalOpenHref = CoreHelperUtil.openHref?.bind(CoreHelperUtil);
    CoreHelperUtil.openHref = function (href: string, target?: string, features?: string) {
      if (href) {
        if (href.includes('bitcoin.com') || href.includes('bitcoincom')) {
          const wcMatch = href.match(/wc\?uri=([^&]+)/);
          const wcUri = wcMatch ? decodeURIComponent(wcMatch[1]) : ConnectionController.state.wcUri;
          launchBitcoinComWalletApp(wcUri);
          return;
        }
        openWalletRedirectUrl(href, target);
      }
      if (originalOpenHref && href?.startsWith('http') && !href.includes('bitcoin.com')) {
        try {
          originalOpenHref(href, target, features);
        } catch (_) {}
      }
    };
  } catch (err) {
    console.warn('Patching CoreHelperUtil.openHref fallback', err);
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
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#06b6d4',
    '--w3m-border-radius-master': '16px',
    '--w3m-z-index': 99999,
  },
});

// Setup automatic watcher for Bitcoin.com and mobile wallet views to immediately redirect
if (typeof window !== 'undefined') {
  let lastRedirectedUri = '';

  const triggerAutoRedirectIfConnecting = () => {
    const currentView = RouterController.state.view;
    const isConnectingView =
      currentView === 'ConnectingWalletConnect' ||
      currentView === 'ConnectingWalletConnectBasic' ||
      currentView === 'ConnectingExternal';

    const wcUri = ConnectionController.state.wcUri;
    const walletData = RouterController.state.data?.wallet;
    const walletName = (walletData?.name || '').toLowerCase();
    const isBitcoinCom =
      walletName.includes('bitcoin') ||
      walletName.includes('verse') ||
      walletData?.mobile_link?.includes('bitcoincom');

    if (isConnectingView && wcUri && wcUri !== lastRedirectedUri) {
      lastRedirectedUri = wcUri;
      const encodedWcUri = encodeURIComponent(wcUri);

      if (isBitcoinCom || !walletData || walletData.mobile_link?.includes('bitcoincom')) {
        // Direct Bitcoin.com App Launch (Android Intent & Scheme)
        launchBitcoinComWalletApp(wcUri);
      } else if (walletData?.mobile_link) {
        const { redirect, redirectUniversalLink } = CoreHelperUtil.formatNativeUrl(
          walletData.mobile_link,
          wcUri
        );
        openWalletRedirectUrl(redirect || redirectUniversalLink || `wc:${wcUri}`);
      }
    }
  };

  // Subscribe to URI generation & Router view changes
  ConnectionController.subscribeKey('wcUri', () => {
    triggerAutoRedirectIfConnecting();
  });

  RouterController.subscribeKey('view', () => {
    setTimeout(triggerAutoRedirectIfConnecting, 50);
  });
}

/**
 * Robust disconnect helper that terminates active WalletConnect & AppKit connections,
 * clears storage keys, closes open modals, and resets controllers for clean reconnection.
 */
export async function disconnectWalletSession(): Promise<void> {
  try {
    if (appKit && typeof (appKit as any).disconnect === 'function') {
      await (appKit as any).disconnect();
    }
  } catch (err) {
    console.warn('[Web3] appKit.disconnect error:', err);
  }

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

  try {
    if (ModalController && typeof ModalController.close === 'function') {
      ModalController.close();
    }
  } catch (_) {}

  // Thoroughly clear session items in localStorage so reconnection is 100% fresh
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('verseswap_wallet');
      localStorage.removeItem('payflux_wallet');
      localStorage.removeItem('wagmi.connected');
      localStorage.removeItem('wagmi.recentConnectorId');
      localStorage.removeItem('wagmi.store');
      localStorage.removeItem('@w3m/connected_connector');
      localStorage.removeItem('@w3m/connected_wallet_image_url');
      localStorage.removeItem('@appkit/connected_connector');
      localStorage.removeItem('@appkit/connected_wallet_image_url');
      localStorage.removeItem('@appkit/recent_wallets');
      sessionStorage.removeItem('wagmi.connected');
    } catch (_) {}
  }
}

