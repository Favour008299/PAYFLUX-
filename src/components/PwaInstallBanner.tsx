import React, { useState, useEffect } from 'react';
import {
  Download,
  Smartphone,
  CheckCircle2,
  RefreshCw,
  X,
  Share,
  PlusSquare,
  Sparkles,
  Zap,
  ShieldCheck
} from 'lucide-react';
import { usePwaInstall, triggerOpenInstallModal } from '../hooks/usePwaInstall';

const payFluxLogoSrc = '/icon-192.png';

interface PwaInstallBannerProps {
  mode?: 'floating' | 'card' | 'navbar-button' | 'modal';
  className?: string;
}

export const PwaInstallBanner: React.FC<PwaInstallBannerProps> = ({
  mode = 'floating',
  className = '',
}) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    hasUpdateAvailable,
    promptInstall,
    applyUpdate,
  } = usePwaInstall();

  // Control whether the install prompt modal is visible
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      if (localStorage.getItem('payflux_pwa_installed') === 'true') {
        return true;
      }
      const dismissedUntil = localStorage.getItem('payflux_pwa_install_dismissed_until');
      if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
        return true;
      }
    }
    return false;
  });

  const [installing, setInstalling] = useState<boolean>(false);
  const [justInstalled, setJustInstalled] = useState<boolean>(false);
  const [showIosGuide, setShowIosGuide] = useState<boolean>(false);

  // Listen for manual trigger from navbar, tabs, or settings
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOpenModal = () => {
      setShowIosGuide(false);
      setJustInstalled(false);
      setIsDismissed(false);
      setIsOpen(true);
    };

    const handleAppInstalled = () => {
      setJustInstalled(true);
      setTimeout(() => {
        setIsOpen(false);
      }, 2000);
    };

    window.addEventListener('payflux-open-install-modal', handleOpenModal);
    window.addEventListener('payflux-app-installed', handleAppInstalled);

    // If already installed, never auto-prompt
    if (isInstalled) {
      setIsOpen(false);
      return () => {
        window.removeEventListener('payflux-open-install-modal', handleOpenModal);
        window.removeEventListener('payflux-app-installed', handleAppInstalled);
      };
    }

    // Auto-prompt on initial app open for web users if not installed and not dismissed
    if (mode === 'floating' && !isDismissed) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 2500);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('payflux-open-install-modal', handleOpenModal);
        window.removeEventListener('payflux-app-installed', handleAppInstalled);
      };
    }

    return () => {
      window.removeEventListener('payflux-open-install-modal', handleOpenModal);
      window.removeEventListener('payflux-app-installed', handleAppInstalled);
    };
  }, [isInstalled, isDismissed, mode]);

  const handleDismiss = () => {
    setIsOpen(false);
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'payflux_pwa_install_dismissed_until',
        String(Date.now() + 24 * 60 * 60 * 1000)
      );
    }
  };

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIosGuide(true);
      return;
    }

    setInstalling(true);
    try {
      // Trigger the browser native beforeinstallprompt prompt
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setJustInstalled(true);
        setTimeout(() => {
          setIsOpen(false);
        }, 2200);
      } else if (outcome === 'manual-instructions') {
        setShowIosGuide(true);
      }
    } catch (err) {
      console.warn('[PayFlux PWA] Prompt notice:', err);
      setShowIosGuide(true);
    } finally {
      setInstalling(false);
    }
  };

  // 1. UPDATE AVAILABLE BANNER (Top Priority)
  if (hasUpdateAvailable && mode === 'floating') {
    return (
      <div className="bg-gradient-to-r from-cyan-600 via-blue-600 to-purple-600 text-white px-4 py-2.5 shadow-lg border-b border-cyan-400/30 flex items-center justify-between text-xs animate-in slide-in-from-top duration-300 z-50">
        <div className="flex items-center gap-2 max-w-xl">
          <div className="p-1 rounded-lg bg-white/20">
            <RefreshCw className="w-4 h-4 text-cyan-200 animate-spin" />
          </div>
          <div>
            <span className="font-bold">New PayFlux version available!</span>
            <span className="hidden sm:inline text-cyan-100 ml-1.5">
              Update to get the latest features and network improvements.
            </span>
          </div>
        </div>
        <button
          id="btn-pwa-apply-update"
          onClick={applyUpdate}
          className="px-3.5 py-1.5 rounded-xl bg-white text-slate-950 hover:bg-slate-100 font-black text-xs shadow-md transition-all shrink-0 ml-3 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Update Now</span>
        </button>
      </div>
    );
  }

  // 2. NAVBAR BUTTON MODE
  if (mode === 'navbar-button') {
    if (isInstalled) return null;
    return (
      <button
        id="btn-navbar-install-pwa"
        onClick={() => triggerOpenInstallModal()}
        title="Install PayFlux App on your device"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-blue-600/20 hover:from-cyan-500/30 hover:to-blue-600/30 border border-cyan-500/40 text-cyan-300 font-bold text-xs transition-all shadow-sm shadow-cyan-950/50 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-cyan-400" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  }

  // 3. SETTINGS CARD MODE
  if (mode === 'card') {
    if (isInstalled) {
      return (
        <div className={`p-4 rounded-2xl bg-slate-950/80 border border-emerald-500/30 flex items-center justify-between ${className}`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>PayFlux installed</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                  Standalone
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Running as a dedicated application without browser bars.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`p-4 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-cyan-500/30 space-y-3 ${className}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src={payFluxLogoSrc}
              alt="PayFlux"
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-xl object-cover border border-cyan-400/40 shadow-md"
            />
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>Install PayFlux Web App</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold uppercase tracking-wider">
                  PWA
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Instant launch and full-screen experience.
              </p>
            </div>
          </div>
        </div>

        <button
          id="btn-settings-install-pwa"
          onClick={() => triggerOpenInstallModal()}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Download className="w-4 h-4 text-slate-950" />
          <span>Install PayFlux App</span>
        </button>
      </div>
    );
  }

  // 4. COMPACT & SLEEK INSTALL PROMPT MODAL
  if (!isOpen || (isInstalled && !justInstalled)) {
    return null;
  }

  return (
    <div
      id="pwa-install-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div
        id="pwa-install-modal-container"
        className="relative w-full max-w-[340px] rounded-2xl bg-[#0b0f19] border border-cyan-500/30 shadow-2xl shadow-cyan-950/80 p-5 flex flex-col items-center text-center animate-in zoom-in-95 duration-150 overflow-hidden"
      >
        {/* Ambient Top Glow */}
        <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-b from-cyan-500/15 via-purple-500/5 to-transparent pointer-events-none" />

        {/* Close 'X' Button */}
        <button
          id="btn-close-install-modal"
          onClick={handleDismiss}
          className="absolute top-3.5 right-3.5 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors z-10 cursor-pointer"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {justInstalled ? (
          /* SUCCESS STATE: "PayFlux installed" */
          <div className="py-4 flex flex-col items-center space-y-2 animate-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-1">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <h3 className="text-base font-black text-white">PayFlux installed</h3>
            <p className="text-xs text-slate-300">
              PayFlux is now installed on your device.
            </p>
          </div>
        ) : (
          /* STANDARD COMPACT INSTALL MODAL */
          <>
            {/* App Icon */}
            <div className="relative mb-3 mt-1">
              <div className="w-14 h-14 rounded-2xl overflow-hidden p-0.5 bg-gradient-to-br from-cyan-400 via-purple-500 to-blue-600 shadow-md shadow-cyan-500/25 flex items-center justify-center">
                <img
                  src={payFluxLogoSrc}
                  alt="PayFlux"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover rounded-[14px]"
                />
              </div>
              <div className="absolute -bottom-1 -right-1 px-1.5 py-0.2 rounded-full bg-slate-950 border border-cyan-400/50 text-[9px] font-black text-cyan-300 uppercase tracking-wider flex items-center gap-0.5 shadow-sm">
                <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                <span>PWA</span>
              </div>
            </div>

            {/* Title */}
            <h2 className="text-lg font-black text-white tracking-tight mb-1">
              Install PayFlux
            </h2>

            {/* Description */}
            <p className="text-xs text-slate-300 font-normal leading-relaxed max-w-[280px] mb-3.5">
              Install PayFlux on your device for a faster, app-like experience.
            </p>

            {/* Mini Feature Highlights */}
            <div className="grid grid-cols-3 gap-1.5 w-full mb-4">
              <div className="py-2 px-1 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col items-center text-center">
                <Zap className="w-3.5 h-3.5 text-cyan-400 mb-0.5" />
                <span className="text-[10px] font-semibold text-slate-200">Fast Launch</span>
              </div>
              <div className="py-2 px-1 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col items-center text-center">
                <Smartphone className="w-3.5 h-3.5 text-purple-400 mb-0.5" />
                <span className="text-[10px] font-semibold text-slate-200">Standalone</span>
              </div>
              <div className="py-2 px-1 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col items-center text-center">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 mb-0.5" />
                <span className="text-[10px] font-semibold text-slate-200">Web3 Safe</span>
              </div>
            </div>

            {/* iOS Safari helper if triggered on iOS Safari */}
            {showIosGuide && (
              <div className="w-full mb-3.5 p-3 rounded-xl bg-slate-900 border border-cyan-500/30 text-left space-y-1.5 text-xs text-slate-300 animate-in fade-in duration-150">
                <div className="font-bold text-cyan-300 text-[11px] flex items-center gap-1">
                  <Share className="w-3 h-3 text-cyan-400" />
                  <span>To install on iOS:</span>
                </div>
                <div className="space-y-1 text-[11px] text-slate-300 pl-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-cyan-400">1.</span>
                    <span>Tap <span className="text-white font-bold bg-slate-800 px-1 py-0.5 rounded">Share</span> <Share className="w-3 h-3 inline text-cyan-400" /></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-cyan-400">2.</span>
                    <span>Tap <span className="text-white font-bold bg-slate-800 px-1 py-0.5 rounded">Add to Home Screen</span> <PlusSquare className="w-3 h-3 inline text-cyan-400" /></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-cyan-400">3.</span>
                    <span>Tap <span className="text-cyan-300 font-bold bg-slate-800 px-1 py-0.5 rounded">Add</span></span>
                  </div>
                </div>
              </div>
            )}

            {/* Actions: Install & Cancel */}
            <div className="w-full space-y-2">
              <button
                id="btn-install-payflux-primary"
                onClick={handleInstallClick}
                disabled={installing}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-slate-950 font-black text-xs sm:text-sm tracking-wider uppercase shadow-lg shadow-cyan-500/20 transition-all hover:scale-[1.01] active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75"
              >
                <Download className="w-4 h-4 text-slate-950" />
                <span>{installing ? 'INSTALLING...' : 'INSTALL'}</span>
              </button>

              <button
                id="btn-install-payflux-cancel"
                onClick={handleDismiss}
                className="w-full min-h-[38px] py-1.5 px-3 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900/80 text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer"
              >
                CANCEL
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
