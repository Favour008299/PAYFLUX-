import { useState, useEffect, useCallback } from 'react';

export interface PwaInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  hasUpdateAvailable: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unsupported'>;
  applyUpdate: () => void;
}

let globalDeferredPrompt: any = null;
const installListeners = new Set<(isInstallable: boolean) => void>();

// Register service worker with automatic update checks
export function registerPayFluxServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.log('[PayFlux PWA] Service worker registered successfully');

        // Check for updates on load & periodically every 30 minutes
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PayFlux PWA] New update available');
                window.dispatchEvent(new CustomEvent('payflux-sw-update-available'));
              }
            });
          }
        });

        // Periodic background update check
        setInterval(() => {
          registration.update().catch(() => {});
        }, 30 * 60 * 1000);

        // Check when tab returns to foreground
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {});
          }
        });
      })
      .catch((err) => {
        console.warn('[PayFlux PWA] Service worker registration notice:', err);
      });
  });

  // Handle immediate controller reload when update is applied
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

export function usePwaInstall(): PwaInstallState {
  const [isInstallable, setIsInstallable] = useState<boolean>(Boolean(globalDeferredPrompt));
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = (window.navigator as any).standalone === true;
    return Boolean(isStandalone || isIOSStandalone);
  });

  const [isIOS, setIsIOS] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent) && !(window as any).MSStream;
  });

  const [isAndroid, setIsAndroid] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return /android/i.test(window.navigator.userAgent);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check display mode changes (e.g. if installed)
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsInstalled(e.matches);
    };
    mediaQuery.addEventListener?.('change', handleDisplayModeChange);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      globalDeferredPrompt = e;
      setIsInstallable(true);
      installListeners.forEach((listener) => listener(true));
    };

    const handleAppInstalled = () => {
      globalDeferredPrompt = null;
      setIsInstallable(false);
      setIsInstalled(true);
      installListeners.forEach((listener) => listener(false));
      console.log('[PayFlux PWA] PayFlux was successfully installed on home screen');
    };

    const handleUpdateAvailable = () => {
      setHasUpdateAvailable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('payflux-sw-update-available', handleUpdateAvailable);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('payflux-sw-update-available', handleUpdateAvailable);
      mediaQuery.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unsupported'> => {
    if (!globalDeferredPrompt) {
      return 'unsupported';
    }

    try {
      await globalDeferredPrompt.prompt();
      const choiceResult = await globalDeferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        globalDeferredPrompt = null;
        setIsInstallable(false);
        return 'accepted';
      }
      return 'dismissed';
    } catch (err) {
      console.error('[PayFlux PWA] Error triggering install prompt:', err);
      return 'unsupported';
    }
  }, []);

  const applyUpdate = useCallback(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          window.location.reload();
        }
      });
    }
  }, []);

  return {
    isInstallable,
    isInstalled,
    isIOS,
    isAndroid,
    hasUpdateAvailable,
    promptInstall,
    applyUpdate,
  };
}
