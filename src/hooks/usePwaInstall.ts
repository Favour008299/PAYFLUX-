import { useState, useEffect, useCallback } from 'react';

export interface PwaInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isInIframe: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  hasUpdateAvailable: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'manual-instructions' | 'iframe-redirect'>;
  openStandaloneApp: () => void;
  applyUpdate: () => void;
  openInstallModal: () => void;
}

let globalDeferredPrompt: any = typeof window !== 'undefined' ? (window as any).payfluxDeferredPrompt || null : null;
const installListeners = new Set<(isInstallable: boolean) => void>();

// Capture beforeinstallprompt as early as possible on script load
if (typeof window !== 'undefined') {
  if ((window as any).payfluxDeferredPrompt) {
    globalDeferredPrompt = (window as any).payfluxDeferredPrompt;
  }

  window.addEventListener('payflux-installable-ready', () => {
    if ((window as any).payfluxDeferredPrompt) {
      globalDeferredPrompt = (window as any).payfluxDeferredPrompt;
      installListeners.forEach((listener) => listener(true));
    }
  });

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e;
    (window as any).payfluxDeferredPrompt = e;
    installListeners.forEach((listener) => listener(true));
    console.log('[PayFlux PWA] Native beforeinstallprompt captured and ready');
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    (window as any).payfluxDeferredPrompt = null;
    installListeners.forEach((listener) => listener(false));
    console.log('[PayFlux PWA] App installed successfully to device home screen');
    window.dispatchEvent(new CustomEvent('payflux-app-installed'));
  });
}

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

export function triggerOpenInstallModal() {
  if (typeof window !== 'undefined') {
    // Dispatch custom event to all listeners
    window.dispatchEvent(new CustomEvent('payflux-open-install-modal'));
  }
}

export function usePwaInstall(): PwaInstallState {
  const [isInstallable, setIsInstallable] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(globalDeferredPrompt || (window as any).payfluxDeferredPrompt);
  });
  
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(false);
  
  const [isInIframe, setIsInIframe] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.self !== window.top;
    } catch (_) {
      return true;
    }
  });

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

  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const userAgent = window.navigator.userAgent.toLowerCase();
    return !/iphone|ipad|ipod|android|mobile/.test(userAgent);
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
      (window as any).payfluxDeferredPrompt = e;
      setIsInstallable(true);
    };

    const handleReady = () => {
      if ((window as any).payfluxDeferredPrompt) {
        globalDeferredPrompt = (window as any).payfluxDeferredPrompt;
        setIsInstallable(true);
      }
    };

    const handleAppInstalled = () => {
      globalDeferredPrompt = null;
      (window as any).payfluxDeferredPrompt = null;
      setIsInstallable(false);
      setIsInstalled(true);
    };

    const handleUpdateAvailable = () => {
      setHasUpdateAvailable(true);
    };

    const listener = (installable: boolean) => {
      setIsInstallable(installable);
    };
    installListeners.add(listener);

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('payflux-installable-ready', handleReady);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('payflux-app-installed', handleAppInstalled);
    window.addEventListener('payflux-sw-update-available', handleUpdateAvailable);

    return () => {
      installListeners.delete(listener);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('payflux-installable-ready', handleReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('payflux-app-installed', handleAppInstalled);
      window.removeEventListener('payflux-sw-update-available', handleUpdateAvailable);
      mediaQuery.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const openStandaloneApp = useCallback(() => {
    if (typeof window !== 'undefined') {
      const targetUrl = window.location.href;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'manual-instructions' | 'iframe-redirect'> => {
    const promptObj = globalDeferredPrompt || (typeof window !== 'undefined' ? (window as any).payfluxDeferredPrompt : null);
    
    // If inside an iframe (like the AI Studio webview preview), browser policy prevents beforeinstallprompt.
    if (isInIframe) {
      openStandaloneApp();
      return 'iframe-redirect';
    }

    if (!promptObj) {
      return 'manual-instructions';
    }

    try {
      await promptObj.prompt();
      const choiceResult = await promptObj.userChoice;
      if (choiceResult.outcome === 'accepted') {
        globalDeferredPrompt = null;
        if (typeof window !== 'undefined') (window as any).payfluxDeferredPrompt = null;
        setIsInstallable(false);
        setIsInstalled(true);
        return 'accepted';
      }
      return 'dismissed';
    } catch (err) {
      console.warn('[PayFlux PWA] Error triggering install prompt:', err);
      return 'manual-instructions';
    }
  }, [isInIframe, openStandaloneApp]);

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

  const openInstallModal = useCallback(() => {
    triggerOpenInstallModal();
  }, []);

  return {
    isInstallable,
    isInstalled,
    isInIframe,
    isIOS,
    isAndroid,
    isDesktop,
    hasUpdateAvailable,
    promptInstall,
    openStandaloneApp,
    applyUpdate,
    openInstallModal,
  };
}
