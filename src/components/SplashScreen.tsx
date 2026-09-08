import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, RotateCw, ArrowRight } from 'lucide-react';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';

interface SplashScreenProps {
  isLoading: boolean;
  loadingStep?: string;
  error?: string | null;
  onRetry?: () => void;
  onContinue?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  isLoading,
  loadingStep = 'Initializing payment engine...',
  error = null,
  onRetry,
  onContinue,
}) => {
  // Grace period timer: if loading takes longer than 2.2 seconds, offer a manual continue/retry option
  const [showFailsafe, setShowFailsafe] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowFailsafe(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowFailsafe(true);
    }, 2200);

    return () => clearTimeout(timer);
  }, [isLoading]);

  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          key="payflux-splash-screen"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.35, ease: 'easeInOut' }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-slate-100 select-none overflow-hidden"
          style={{ willChange: 'opacity, transform' }}
        >
          {/* Ambient Lighting Gradients */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] sm:w-[36rem] sm:h-[36rem] bg-gradient-to-tr from-purple-600/15 via-cyan-500/15 to-blue-600/10 blur-3xl -z-10 pointer-events-none rounded-full" />
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-48 bg-cyan-500/10 blur-3xl rounded-full pointer-events-none" />

          {/* Centered Brand Content */}
          <div className="flex flex-col items-center text-center px-6 max-w-md w-full">
            {/* Logo with Glow Ring */}
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="relative mb-6 group"
            >
              <div className="absolute -inset-1.5 bg-gradient-to-r from-cyan-500 via-purple-500 to-blue-500 rounded-3xl blur-md opacity-40 animate-pulse" />
              <img
                src={payFluxLogoSrc}
                alt="PayFlux"
                referrerPolicy="no-referrer"
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl object-cover object-center relative border border-cyan-400/40 shadow-2xl shadow-cyan-950/80"
              />
            </motion.div>

            {/* App Name & Badge */}
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.35 }}
              className="flex items-center justify-center gap-2 mb-2"
            >
              <h1 className="font-black text-3xl sm:text-4xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-cyan-300 bg-clip-text text-transparent">
                PayFlux
              </h1>
              <span className="text-[10px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-sm">
                PAY
              </span>
            </motion.div>

            {/* Tagline */}
            <motion.p
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.35 }}
              className="text-slate-300 text-sm sm:text-base font-medium tracking-tight mb-8"
            >
              Pay Your Way. Merchants Get Theirs.
            </motion.p>

            {/* Loading Indicator or Error State */}
            {!error ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.3 }}
                className="w-full flex flex-col items-center"
              >
                {/* Subtle, polished loading bar */}
                <div className="w-48 sm:w-56 h-1 bg-slate-800/80 rounded-full overflow-hidden relative mb-3 border border-slate-700/40">
                  <motion.div
                    className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-cyan-400 via-purple-400 to-cyan-400 rounded-full"
                    initial={{ x: '-100%', width: '50%' }}
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{
                      repeat: Infinity,
                      duration: 1.4,
                      ease: 'easeInOut',
                    }}
                  />
                </div>

                {/* Status text */}
                <p className="text-xs text-slate-400 font-mono tracking-wide">
                  {loadingStep}
                </p>

                {/* Graceful Failsafe Option if network takes unusually long */}
                {showFailsafe && (
                  <motion.button
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={onContinue}
                    className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-700/70 text-slate-200 text-xs font-semibold hover:bg-slate-800 transition-colors shadow-lg"
                  >
                    <span>Continue to PayFlux</span>
                    <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
                  </motion.button>
                )}
              </motion.div>
            ) : (
              /* Error State with Retry Button */
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full flex flex-col items-center gap-3 bg-red-950/40 border border-red-800/50 rounded-2xl p-4 shadow-xl"
              >
                <div className="flex items-center gap-2 text-red-300 text-xs font-medium text-left">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
                <div className="flex items-center gap-2 w-full justify-center mt-1">
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-900/60 border border-red-700/50 text-red-200 text-xs font-semibold transition-colors"
                    >
                      <RotateCw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  )}
                  {onContinue && (
                    <button
                      onClick={onContinue}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                    >
                      <span>Continue Anyway</span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </div>

          {/* Minimalist Bottom Footnote */}
          <div className="absolute bottom-6 left-0 right-0 text-center">
            <span className="text-[11px] text-slate-400 font-medium">
              Non-custodial Crypto Payments & Settlement
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
