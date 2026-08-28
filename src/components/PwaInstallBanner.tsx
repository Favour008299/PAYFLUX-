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
  ShieldCheck,
  Monitor,
  Copy,
  ExternalLink,
  Info
} from 'lucide-react';
import { usePwaInstall, triggerOpenInstallModal } from '../hooks/usePwaInstall';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';

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
    isAndroid,
    isDesktop,
    hasUpdateAvailable,
    promptInstall,
    applyUpdate,
    openInstallModal,
  } = usePwaInstall();

  // Control whether the install prompt is visible
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const dismissedUntil = localStorage.getItem('payflux_pwa_install_dismissed_until');
      if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
        return true;
      }
    }
    return false;
  });

  const [showManualGuide, setShowManualGuide] = useState<boolean>(false);
  const [installing, setInstalling] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Auto-prompt on initial app open for web users if not installed and not dismissed
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Listen for manual trigger from navbar, tabs, or settings
    const handleOpenModal = () => {
      setShowManualGuide(false);
      setIsDismissed(false);
      setIsOpen(true);
    };

    window.addEventListener('payflux-open-install-modal', handleOpenModal);

    // If already installed in standalone mode, never auto-prompt
    if (isInstalled) {
      setIsOpen(false);
      return () => {
        window.removeEventListener('payflux-open-install-modal', handleOpenModal);
      };
    }

    // If floating mode and not dismissed, show prompt after a brief natural delay
    if (mode === 'floating' && !isDismissed) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 1500);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('payflux-open-install-modal', handleOpenModal);
      };
    }

    return () => {
      window.removeEventListener('payflux-open-install-modal', handleOpenModal);
    };
  }, [isInstalled, isDismissed, mode]);

  const handleDismiss = () => {
    setIsOpen(false);
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      // Dismiss auto-popup for 24 hours (manual clicks on buttons will always re-open)
      localStorage.setItem(
        'payflux_pwa_install_dismissed_until',
        String(Date.now() + 24 * 60 * 60 * 1000)
      );
    }
  };

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowManualGuide(true);
      return;
    }

    setInstalling(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setIsOpen(false);
        setIsDismissed(true);
      } else if (outcome === 'manual-instructions') {
        setShowManualGuide(true);
      }
    } catch (err) {
      console.warn('[PayFlux PWA] Prompt notice:', err);
      setShowManualGuide(true);
    } finally {
      setInstalling(false);
    }
  };

  const handleCopyAppUrl = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.origin);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
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
        <Download className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
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
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>PayFlux App Installed</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
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
      <div className={`p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-cyan-500/30 space-y-3 ${className}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src={payFluxLogoSrc}
              alt="PayFlux"
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-2xl object-cover border border-cyan-400/40 shadow-lg"
            />
            <div>
              <div className="text-xs font-black text-white flex items-center gap-1.5">
                <span>Install PayFlux Web App</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold uppercase tracking-wider">
                  PWA
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Install on your device for instant launch and full-screen payments with no browser bars.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-1">
          <button
            id="btn-settings-install-pwa"
            onClick={() => triggerOpenInstallModal()}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-950" />
            <span>Install PayFlux App</span>
          </button>
        </div>
      </div>
    );
  }

  // 4. MAIN INSTALL PROMPT MODAL (Cross-Device Compatible, matching the visual inspiration)
  if (!isOpen || isInstalled) {
    return null;
  }

  return (
    <div
      id="pwa-install-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        id="pwa-install-modal-container"
        className="relative w-full max-w-sm sm:max-w-md rounded-3xl bg-[#0b0f19] border border-cyan-500/30 shadow-2xl shadow-cyan-950/90 p-6 sm:p-8 flex flex-col items-center text-center animate-in zoom-in-95 duration-200 overflow-hidden"
      >
        {/* Ambient Top Glow */}
        <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-cyan-500/20 via-purple-500/10 to-transparent pointer-events-none" />

        {/* Close 'X' Button */}
        <button
          id="btn-close-install-modal"
          onClick={handleDismiss}
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors z-10 cursor-pointer"
          title="Close prompt"
        >
          <X className="w-5 h-5" />
        </button>

        {/* PayFlux App Icon */}
        <div className="relative mb-5 mt-2">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl sm:rounded-3xl overflow-hidden p-0.5 bg-gradient-to-br from-cyan-400 via-purple-500 to-blue-600 shadow-xl shadow-cyan-500/30 flex items-center justify-center">
            <img
              src={payFluxLogoSrc}
              alt="PayFlux"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover rounded-2xl sm:rounded-3xl"
            />
          </div>
          <div className="absolute -bottom-1.5 -right-1.5 px-2 py-0.5 rounded-full bg-slate-950 border border-cyan-400/50 text-[10px] font-black text-cyan-300 uppercase tracking-wider flex items-center gap-1 shadow-md">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span>PWA</span>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight mb-2">
          Install PayFlux
        </h2>

        {/* Description */}
        <p className="text-xs sm:text-sm text-slate-300 font-normal leading-relaxed max-w-xs sm:max-w-sm mb-5">
          {isIOS || isAndroid
            ? 'Install PayFlux on your phone for a faster, app-like experience.'
            : 'Install PayFlux on your device for a faster, app-like experience.'}
        </p>

        {/* Feature Highlights */}
        <div className="grid grid-cols-3 gap-2 w-full mb-5">
          <div className="p-2.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex flex-col items-center text-center">
            <Zap className="w-4 h-4 text-cyan-400 mb-1" />
            <span className="text-[10px] font-bold text-slate-200">Fast Launch</span>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex flex-col items-center text-center">
            <Smartphone className="w-4 h-4 text-purple-400 mb-1" />
            <span className="text-[10px] font-bold text-slate-200">Standalone</span>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex flex-col items-center text-center">
            <ShieldCheck className="w-4 h-4 text-emerald-400 mb-1" />
            <span className="text-[10px] font-bold text-slate-200">Web3 Safe</span>
          </div>
        </div>

        {/* Manual Device Installation Guide (Expanded when native prompt is not available) */}
        {showManualGuide ? (
          <div className="w-full mb-5 p-4 rounded-2xl bg-slate-900/90 border border-cyan-500/40 text-left space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-xs text-cyan-300">
                {isIOS ? <Smartphone className="w-4 h-4 text-cyan-400" /> : <Monitor className="w-4 h-4 text-cyan-400" />}
                <span>{isIOS ? 'Install on iOS (Safari):' : 'Add to Home Screen / Desktop:'}</span>
              </div>
              <button
                onClick={handleCopyAppUrl}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-cyan-300 font-semibold transition-colors"
                title="Copy Web App Link"
              >
                {copiedLink ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedLink ? 'Copied Link' : 'Copy Link'}</span>
              </button>
            </div>

            {isIOS ? (
              <ol className="text-xs text-slate-300 space-y-2 pl-1">
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-cyan-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                  <span>Tap the <span className="text-white font-bold inline-flex items-center gap-0.5 bg-slate-800 px-1.5 py-0.5 rounded"><Share className="w-3 h-3 inline text-cyan-400" /> Share</span> button at the bottom of Safari.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-cyan-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                  <span>Scroll down and select <span className="text-white font-bold inline-flex items-center gap-0.5 bg-slate-800 px-1.5 py-0.5 rounded"><PlusSquare className="w-3 h-3 inline text-cyan-400" /> Add to Home Screen</span>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-cyan-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                  <span>Tap <span className="text-cyan-300 font-bold bg-slate-800 px-1.5 py-0.5 rounded">Add</span> in the top-right corner.</span>
                </li>
              </ol>
            ) : (
              <ol className="text-xs text-slate-300 space-y-2 pl-1">
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-cyan-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                  <span>Click the browser menu <span className="text-white font-bold bg-slate-800 px-1.5 py-0.5 rounded">(⋮)</span> or address bar install icon <Download className="w-3 h-3 inline text-cyan-400" />.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-cyan-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                  <span>Select <span className="text-white font-bold bg-slate-800 px-1.5 py-0.5 rounded">"Install PayFlux"</span> or <span className="text-white font-bold bg-slate-800 px-1.5 py-0.5 rounded">"Add to Home Screen"</span>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-cyan-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                  <span>Confirm by clicking <span className="text-cyan-300 font-bold bg-slate-800 px-1.5 py-0.5 rounded">Install</span>.</span>
                </li>
              </ol>
            )}
          </div>
        ) : null}

        {/* Buttons */}
        <div className="w-full space-y-2.5">
          <button
            id="btn-install-payflux-primary"
            onClick={handleInstallClick}
            disabled={installing}
            className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-slate-950 font-black text-sm sm:text-base tracking-wider uppercase shadow-xl shadow-cyan-500/25 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75"
          >
            <Download className="w-5 h-5 text-slate-950" />
            <span>{installing ? 'Opening Install...' : 'INSTALL'}</span>
          </button>

          <button
            id="btn-install-payflux-cancel"
            onClick={handleDismiss}
            className="w-full py-2.5 px-4 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 text-xs sm:text-sm font-bold tracking-wider uppercase transition-colors cursor-pointer"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
};
