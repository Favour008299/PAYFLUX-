import { useState, useEffect, useCallback } from 'react';

export interface PwaInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  hasUpdateAvailable: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'manual-instructions'>;
  applyUpdate: () => void;
  openInstallModal: () => void;
}

let globalDeferredPrompt: any = typeof window !== 'undefined' ? (window as any).payfluxDeferredPrompt || null : null;
const installListeners = new Set<(isInstallable: boolean) => void>();

function checkIsAppInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem('payflux_pwa_installed') === 'true') {
      return true;
    }
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = (window.navigator as any).standalone === true;
    return Boolean(isStandalone || isIOSStandalone);
  } catch (_) {
    return false;
  }
}

// Capture beforeinstallprompt as early as possible
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
    // Prevent standard mini-infobar from appearing on mobile
    e.preventDefault();
    globalDeferredPrompt = e;
    (window as any).payfluxDeferredPrompt = e;
    installListeners.forEach((listener) => listener(true));
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    (window as any).payfluxDeferredPrompt = null;
    try {
      localStorage.setItem('payflux_pwa_installed', 'true');
    } catch (_) {}
    installListeners.forEach((listener) => listener(false));
    window.dispatchEvent(new CustomEvent('payflux-app-installed'));
  });
}

// Register service worker with automatic update checks
export function registerPayFluxServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // Check for updates on load & periodically
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                window.dispatchEvent(new CustomEvent('payflux-sw-update-available'));
              }
            });
          }
        });

        setInterval(() => {
          registration.update().catch(() => {});
        }, 30 * 60 * 1000);

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {});
          }
        });
      })
      .catch((err) => {
        console.warn('[PayFlux PWA] Service worker notice:', err);
      });
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    register();
  } else {
    window.addEventListener('load', register);
  }

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
    window.dispatchEvent(new CustomEvent('payflux-open-install-modal'));
  }
}

export function usePwaInstall(): PwaInstallState {
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkIsAppInstalled());
  const [isInstallable, setIsInstallable] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (checkIsAppInstalled()) return false;
    return Boolean(globalDeferredPrompt || (window as any).payfluxDeferredPrompt);
  });
  
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(false);

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

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        setIsInstallable(false);
        try {
          localStorage.setItem('payflux_pwa_installed', 'true');
        } catch (_) {}
      }
    };
    mediaQuery.addEventListener?.('change', handleDisplayModeChange);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      globalDeferredPrompt = e;
      (window as any).payfluxDeferredPrompt = e;
      if (!checkIsAppInstalled()) {
        setIsInstallable(true);
      }
    };

    const handleReady = () => {
      if ((window as any).payfluxDeferredPrompt) {
        globalDeferredPrompt = (window as any).payfluxDeferredPrompt;
        if (!checkIsAppInstalled()) {
          setIsInstallable(true);
        }
      }
    };

    const handleAppInstalled = () => {
      globalDeferredPrompt = null;
      (window as any).payfluxDeferredPrompt = null;
      setIsInstallable(false);
      setIsInstalled(true);
      try {
        localStorage.setItem('payflux_pwa_installed', 'true');
      } catch (_) {}
    };

    const handleUpdateAvailable = () => {
      setHasUpdateAvailable(true);
    };

    const listener = (installable: boolean) => {
      if (!checkIsAppInstalled()) {
        setIsInstallable(installable);
      }
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

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'manual-instructions'> => {
    const promptObj = globalDeferredPrompt || (typeof window !== 'undefined' ? (window as any).payfluxDeferredPrompt : null);

    if (!promptObj) {
      return 'manual-instructions';
    }

    try {
      // Trigger the native browser install prompt dialog
      await promptObj.prompt();
      const choiceResult = await promptObj.userChoice;

      if (choiceResult && choiceResult.outcome === 'accepted') {
        globalDeferredPrompt = null;
        if (typeof window !== 'undefined') {
          (window as any).payfluxDeferredPrompt = null;
          try {
            localStorage.setItem('payflux_pwa_installed', 'true');
          } catch (_) {}
        }
        setIsInstallable(false);
        setIsInstalled(true);
        window.dispatchEvent(new CustomEvent('payflux-app-installed'));
        return 'accepted';
      }
      return 'dismissed';
    } catch (err) {
      console.warn('[PayFlux PWA] Error triggering install prompt:', err);
      return 'manual-instructions';
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

  const openInstallModal = useCallback(() => {
    triggerOpenInstallModal();
  }, []);

  return {
    isInstallable,
    isInstalled,
    isIOS,
    isAndroid,
    isDesktop,
    hasUpdateAvailable,
    promptInstall,
    applyUpdate,
    openInstallModal,
  };
}
