import React, { useState } from 'react';
import {
  Download,
  Smartphone,
  CheckCircle2,
  RefreshCw,
  X,
  Share,
  PlusSquare,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';

interface PwaInstallBannerProps {
  mode?: 'floating' | 'card' | 'navbar-button';
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
    hasUpdateAvailable,
    promptInstall,
    applyUpdate,
  } = usePwaInstall();

  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const dismissedUntil = localStorage.getItem('payflux_pwa_banner_dismissed_until');
      if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
        return true;
      }
    }
    return false;
  });

  const [showIosGuide, setShowIosGuide] = useState<boolean>(false);
  const [installing, setInstalling] = useState<boolean>(false);

  const handleDismiss = () => {
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      // Dismiss for 7 days
      localStorage.setItem(
        'payflux_pwa_banner_dismissed_until',
        String(Date.now() + 7 * 24 * 60 * 60 * 1000)
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
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setIsDismissed(true);
      }
    } finally {
      setInstalling(false);
    }
  };

  // 1. UPDATE AVAILABLE BANNER (Highest Priority)
  if (hasUpdateAvailable) {
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
          className="px-3 py-1.5 rounded-lg bg-white text-slate-950 hover:bg-slate-100 font-extrabold text-xs shadow-md transition-all shrink-0 ml-3 flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Update Now</span>
        </button>
      </div>
    );
  }

  // If already running in standalone mode, do not show install banners (unless in card mode where we show 'Installed')
  if (isInstalled) {
    if (mode === 'card') {
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
                Running in dedicated window without browser address bar.
              </p>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  // 2. NAVBAR BUTTON MODE
  if (mode === 'navbar-button') {
    if (!isInstallable && !isIOS) return null;
    return (
      <button
        id="btn-navbar-install-pwa"
        onClick={handleInstallClick}
        title="Install PayFlux App on your device"
        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-bold text-xs transition-all shadow-sm shadow-cyan-950/50 hover:scale-[1.02] active:scale-[0.98]"
      >
        <Download className="w-3.5 h-3.5 text-cyan-400" />
        <span>Install App</span>
      </button>
    );
  }

  // 3. SETTINGS CARD MODE
  if (mode === 'card') {
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

        <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
          <button
            id="btn-settings-install-pwa"
            onClick={handleInstallClick}
            disabled={installing}
            className="w-full sm:w-auto flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-950" />
            <span>{installing ? 'Opening Prompt...' : 'Install PayFlux to Home Screen'}</span>
          </button>
        </div>

        {/* iOS / Safari Manual Instructions */}
        {showIosGuide && isIOS && (
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 space-y-2 animate-in fade-in duration-200">
            <div className="font-bold text-cyan-300 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5" />
              <span>How to Install on iOS (Safari):</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-slate-400 pl-1">
              <li>Tap the <span className="text-white font-bold inline-flex items-center gap-0.5"><Share className="w-3 h-3 inline" /> Share</span> icon at the bottom of Safari.</li>
              <li>Scroll down and select <span className="text-white font-bold inline-flex items-center gap-0.5"><PlusSquare className="w-3 h-3 inline" /> Add to Home Screen</span>.</li>
              <li>Tap <span className="text-cyan-400 font-bold">Add</span> in the top-right corner.</li>
            </ol>
          </div>
        )}
      </div>
    );
  }

  // 4. FLOATING BOTTOM / BANNER PROMPT (Only show if not dismissed and installable or on mobile)
  if (isDismissed || (!isInstallable && !isIOS)) {
    return null;
  }

  return (
    <>
      <div
        id="pwa-floating-install-banner"
        className={`fixed bottom-16 sm:bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-40 p-4 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-cyan-500/40 shadow-2xl shadow-cyan-950/80 text-white animate-in slide-in-from-bottom-5 duration-300 ${className}`}
      >
        <button
          id="btn-close-pwa-banner"
          onClick={handleDismiss}
          className="absolute top-2.5 right-2.5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Dismiss install banner"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3">
          <img
            src={payFluxLogoSrc}
            alt="PayFlux"
            referrerPolicy="no-referrer"
            className="w-11 h-11 rounded-xl object-cover shrink-0 border border-cyan-400/30 shadow-md mt-0.5"
          />
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-1.5">
              <h4 className="font-extrabold text-xs text-white">Install PayFlux App</h4>
              <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[9px] font-bold">
                Standalone
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-snug">
              Add PayFlux to your home screen for instant access, non-custodial crypto swaps, and fullscreen POS checkout.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                id="btn-pwa-floating-install"
                onClick={handleInstallClick}
                disabled={installing}
                className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-950" />
                <span>{installing ? 'Opening...' : 'Install App'}</span>
              </button>
              <button
                onClick={handleDismiss}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
              >
                Not Now
              </button>
            </div>
          </div>
        </div>

        {/* iOS guide expansion */}
        {showIosGuide && isIOS && (
          <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-300 space-y-1.5 animate-in fade-in duration-200">
            <div className="font-bold text-cyan-300 flex items-center gap-1">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Tap Share &rarr; Add to Home Screen:</span>
            </div>
            <p className="text-slate-400">
              1. Tap Safari's <span className="text-white font-semibold">Share</span> button at bottom.<br />
              2. Tap <span className="text-white font-semibold">Add to Home Screen</span>.<br />
              3. Tap <span className="text-cyan-400 font-semibold">Add</span> to install PayFlux.
            </p>
          </div>
        )}
      </div>
    </>
  );
};
