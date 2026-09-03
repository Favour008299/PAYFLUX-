/**
 * Wallet Lifecycle Service for PayFlux
 * 
 * Manages the browser ↔ mobile wallet (Bitcoin.com Wallet) lifecycle:
 * - Preserves pending wallet connection / session state in browser storage (sessionStorage + localStorage)
 * - Detects mobile browser backgrounding, page suspension, bfcache restore, and return events
 * - Automatically recovers pending WalletConnect connections when the user returns to PayFlux
 * - Recovers gracefully across complete page reloads / mobile browser restarts
 * - Extracts confirmed accounts from storage if WalletConnect/AppKit already paired in the background
 * - Prevents duplicate connection requests when a connection is valid or pending
 */

import { reconnect } from '@wagmi/core';
import { wagmiAdapter } from '../config/web3';

export interface PendingWalletSession {
  walletName: string;
  walletId?: string;
  wcUri?: string;
  stage: 'opening_app' | 'waiting_approval' | 'verifying' | 'connected' | 'error';
  initiatedAt: number;
  lastActiveAt: number;
  attemptCount: number;
  errorMessage?: string;
}

const STORAGE_KEY = 'payflux_pending_wallet_session';
const PENDING_URI_KEY = 'payflux_pending_wc_uri';
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes maximum validity

/**
 * Retrieves the currently active pending wallet session, or null if none or expired.
 */
export function getPendingConnectionSession(): PendingWalletSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const isExplicitlyDisc = localStorage.getItem('payflux_explicitly_disconnected') === 'true';
    if (isExplicitlyDisc) {
      clearPendingConnectionSession();
      return null;
    }

    // Try sessionStorage first, then fallback to localStorage
    const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const session: PendingWalletSession = JSON.parse(raw);
    const now = Date.now();

    // Invalidate if older than TTL
    if (!session.initiatedAt || now - session.initiatedAt > SESSION_TTL_MS) {
      clearPendingConnectionSession();
      return null;
    }

    return session;
  } catch (err) {
    console.warn('[WalletLifecycle] Error reading pending session:', err);
    return null;
  }
}

/**
 * Saves or updates the pending wallet connection session across both sessionStorage and localStorage.
 */
export function savePendingConnectionSession(
  update: Partial<PendingWalletSession> & { walletName?: string }
): PendingWalletSession {
  if (typeof window === 'undefined') {
    return {
      walletName: update.walletName || 'Bitcoin.com Wallet',
      stage: update.stage || 'opening_app',
      initiatedAt: Date.now(),
      lastActiveAt: Date.now(),
      attemptCount: 1,
      ...update,
    };
  }

  const existing = getPendingConnectionSession();
  const now = Date.now();

  const session: PendingWalletSession = {
    walletName: update.walletName || existing?.walletName || 'Bitcoin.com Wallet',
    walletId: update.walletId || existing?.walletId || 'c286eebc74384d7d6b38c23ac681cf4aa3b290372df03d42e20ffba244f77c8e',
    wcUri: update.wcUri || existing?.wcUri,
    stage: update.stage || existing?.stage || 'opening_app',
    initiatedAt: existing?.initiatedAt || update.initiatedAt || now,
    lastActiveAt: now,
    attemptCount: (existing?.attemptCount || 0) + (update.attemptCount ? update.attemptCount : 0),
    errorMessage: update.errorMessage,
    ...update,
  };

  try {
    const serialized = JSON.stringify(session);
    sessionStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(STORAGE_KEY, serialized);

    if (session.wcUri) {
      sessionStorage.setItem(PENDING_URI_KEY, session.wcUri);
      localStorage.setItem(PENDING_URI_KEY, session.wcUri);
    }

    // Also persist wallet name choice for AppKit & PayFlux
    localStorage.setItem('payflux_connected_wallet_name', session.walletName);
    localStorage.removeItem('payflux_explicitly_disconnected');

    // Notify listeners in same window
    window.dispatchEvent(
      new CustomEvent('payflux_pending_session_change', { detail: session })
    );
  } catch (err) {
    console.warn('[WalletLifecycle] Error saving pending session:', err);
  }

  return session;
}

/**
 * Clears the pending wallet connection session from all storage.
 */
export function clearPendingConnectionSession(): void {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(PENDING_URI_KEY);
    localStorage.removeItem(PENDING_URI_KEY);

    window.dispatchEvent(
      new CustomEvent('payflux_pending_session_change', { detail: null })
    );
  } catch (err) {
    console.warn('[WalletLifecycle] Error clearing pending session:', err);
  }
}

/**
 * Extracts a valid 0x... EVM account address from AppKit, Wagmi, or WalletConnect localStorage records.
 * This detects connections that succeeded while PayFlux was in the background or restarting.
 */
export function extractConnectedAccountFromStorage(): `0x${string}` | null {
  if (typeof window === 'undefined') return null;

  try {
    // 1. Check PayFlux direct address storage
    const savedAddr = localStorage.getItem('payflux_connected_address');
    if (savedAddr && savedAddr.startsWith('0x') && savedAddr.length === 42) {
      return savedAddr as `0x${string}`;
    }

    // 2. Check @appkit/connections (AppKit v1 storage)
    const appKitConnections = localStorage.getItem('@appkit/connections');
    if (appKitConnections) {
      const parsed = JSON.parse(appKitConnections);
      for (const ns of Object.keys(parsed)) {
        const list = parsed[ns];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (Array.isArray(item?.accounts)) {
              for (const acct of item.accounts) {
                if (typeof acct === 'string') {
                  const parts = acct.split(':');
                  const addr = parts[parts.length - 1];
                  if (addr && addr.startsWith('0x') && addr.length === 42) {
                    return addr as `0x${string}`;
                  }
                }
              }
            }
          }
        }
      }
    }

    // 3. Check WalletConnect v2 sessions in localStorage (wc@2:client:0.3//session)
    const wcSessionRaw = localStorage.getItem('wc@2:client:0.3//session');
    if (wcSessionRaw) {
      const parsed = JSON.parse(wcSessionRaw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const sess of list) {
        if (sess?.namespaces) {
          for (const ns of Object.keys(sess.namespaces)) {
            const accounts = sess.namespaces[ns]?.accounts || [];
            for (const acct of accounts) {
              if (typeof acct === 'string') {
                const parts = acct.split(':');
                const addr = parts[parts.length - 1];
                if (addr && addr.startsWith('0x') && addr.length === 42) {
                  return addr as `0x${string}`;
                }
              }
            }
          }
        }
      }
    }

    // 4. Check wagmi.store
    const wagmiStoreRaw = localStorage.getItem('wagmi.store');
    if (wagmiStoreRaw) {
      const parsed = JSON.parse(wagmiStoreRaw);
      const current = parsed?.state?.current;
      const connections = parsed?.state?.connections?.value || parsed?.state?.connections;
      if (Array.isArray(connections)) {
        for (const entry of connections) {
          const connData = Array.isArray(entry) ? entry[1] : entry;
          const accounts = connData?.accounts;
          if (Array.isArray(accounts) && accounts[0]?.startsWith('0x')) {
            return accounts[0] as `0x${string}`;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[WalletLifecycle] Account extraction error:', err);
  }

  return null;
}

/**
 * Universal Mobile Browser Lifecycle Watcher
 * 
 * Accurately tracks mobile browser state transitions:
 * - Backgrounding: visibilitychange (hidden), pagehide, freeze
 * - Resuming: visibilitychange (visible), focus, pageshow (bfcache restore), resume
 */
export function setupMobileLifecycleWatcher(handlers: {
  onBackground?: () => void;
  onResume?: () => void;
}): () => void {
  if (typeof window === 'undefined') return () => {};

  let lastResumeTriggered = 0;
  const DEBOUNCE_RESUME_MS = 400;

  const handleBackground = () => {
    const session = getPendingConnectionSession();
    if (session) {
      savePendingConnectionSession({ lastActiveAt: Date.now() });
    }
    handlers.onBackground?.();
  };

  const handleResume = () => {
    const now = Date.now();
    if (now - lastResumeTriggered < DEBOUNCE_RESUME_MS) return;
    lastResumeTriggered = now;

    const session = getPendingConnectionSession();
    if (session) {
      savePendingConnectionSession({ lastActiveAt: now });
    }
    handlers.onResume?.();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      handleBackground();
    } else if (document.visibilityState === 'visible') {
      handleResume();
    }
  };

  const handlePageHide = () => {
    handleBackground();
  };

  const handlePageShow = (_e: PageTransitionEvent) => {
    handleResume();
  };

  const handleFocus = () => {
    handleResume();
  };

  // Page Lifecycle API events (Chrome mobile & modern WebKit)
  const handleFreeze = () => {
    handleBackground();
  };

  const handleResumeEvent = () => {
    handleResume();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('focus', handleFocus);
  document.addEventListener('freeze', handleFreeze as any);
  document.addEventListener('resume', handleResumeEvent as any);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
    window.removeEventListener('focus', handleFocus);
    document.removeEventListener('freeze', handleFreeze as any);
    document.removeEventListener('resume', handleResumeEvent as any);
  };
}

/**
 * Polls for connection verification and completion after returning from mobile wallet app.
 * Automatically recovers wagmi state and resolves the connected address.
 */
export function pollForWalletConnection(options: {
  onSuccess: (address: `0x${string}`, walletName: string) => void;
  onWaiting?: (elapsedMs: number) => void;
  onTimeout: () => void;
  maxDurationMs?: number;
  intervalMs?: number;
}): () => void {
  if (typeof window === 'undefined') return () => {};

  const maxDuration = options.maxDurationMs || 14000;
  const interval = options.intervalMs || 700;
  const startTime = Date.now();
  let cancelled = false;

  const attemptCheck = async () => {
    if (cancelled) return;

    // 1. Try to reconnect wagmi config core
    try {
      if (wagmiAdapter?.wagmiConfig) {
        await reconnect(wagmiAdapter.wagmiConfig);
      }
    } catch (_) {}

    // 2. Check Wagmi active state
    try {
      const state = wagmiAdapter?.wagmiConfig?.state;
      const currentId = state?.current;
      if (currentId && state?.connections) {
        const currentConn = state.connections.get ? state.connections.get(currentId) : (state.connections as any)[currentId];
        if (currentConn?.accounts?.[0]) {
          const addr = currentConn.accounts[0] as `0x${string}`;
          const walletName = currentConn.connector?.name || 'Bitcoin.com Wallet';
          finishSuccess(addr, walletName);
          return;
        }
      }
    } catch (_) {}

    // 3. Check storage for freshly synced accounts
    const extracted = extractConnectedAccountFromStorage();
    if (extracted) {
      const savedName = localStorage.getItem('payflux_connected_wallet_name') || 'Bitcoin.com Wallet';
      finishSuccess(extracted, savedName);
      return;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= maxDuration) {
      if (!cancelled) {
        options.onTimeout();
      }
      return;
    }

    options.onWaiting?.(elapsed);
    if (!cancelled) {
      timerId = setTimeout(attemptCheck, interval);
    }
  };

  const finishSuccess = (address: `0x${string}`, walletName: string) => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(timerId);

    localStorage.setItem('payflux_connected_address', address);
    localStorage.setItem('payflux_connected_wallet_name', walletName);
    localStorage.removeItem('payflux_explicitly_disconnected');
    clearPendingConnectionSession();

    options.onSuccess(address, walletName);
  };

  let timerId = setTimeout(attemptCheck, 200);

  return () => {
    cancelled = true;
    clearTimeout(timerId);
  };
}
