import React, { useState, useEffect } from 'react';
import { Fingerprint, ShieldCheck, RefreshCw, AlertCircle, KeyRound } from 'lucide-react';
import { authenticateBiometric } from '../services/biometricAuthService';

interface BiometricLockScreenProps {
  onUnlock: () => void;
}

export const BiometricLockScreen: React.FC<BiometricLockScreenProps> = ({ onUnlock }) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleTriggerAuth = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const result = await authenticateBiometric();
      if (result.success) {
        onUnlock();
      } else {
        setAuthError(result.error || 'Biometric authentication was cancelled or failed.');
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Authentication error. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Attempt biometric prompt automatically on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      handleTriggerAuth();
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950/98 backdrop-blur-2xl flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-sm mx-auto bg-slate-900 border border-slate-800 rounded-3xl p-7 text-center shadow-2xl space-y-6 animate-fadeIn">
        {/* PayFlux Logo & Brand */}
        <div className="flex items-center justify-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="text-white font-black text-sm tracking-tighter">PF</span>
          </div>
          <div className="text-left">
            <h1 className="text-sm font-black text-white tracking-wider">PAYFLUX</h1>
            <p className="text-[10px] text-cyan-400 font-semibold uppercase tracking-wider">App-Access Privacy Lock</p>
          </div>
        </div>

        {/* Biometric Sensor Icon Ring */}
        <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-cyan-500/10 animate-ping opacity-30" />
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-b from-cyan-500/20 to-purple-500/20 border-2 border-cyan-500/50 flex items-center justify-center shadow-xl shadow-cyan-500/20">
            {isAuthenticating ? (
              <RefreshCw className="w-10 h-10 text-cyan-300 animate-spin" />
            ) : (
              <Fingerprint className="w-10 h-10 text-cyan-400" />
            )}
          </div>
        </div>

        {/* Status & Title */}
        <div className="space-y-1.5">
          <h2 className="text-xl font-black text-white">PayFlux is Locked</h2>
          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
            Require fingerprint or device biometric authentication to unlock PayFlux
          </p>
        </div>

        {/* Error Feedback */}
        {authError && (
          <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs text-left flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold">Authentication Notice</span>
              <p className="text-[11px] leading-relaxed text-red-200/90">{authError}</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3 pt-1">
          <button
            id="biometric-unlock-button"
            type="button"
            disabled={isAuthenticating}
            onClick={handleTriggerAuth}
            className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isAuthenticating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                <span>Verifying Biometrics...</span>
              </>
            ) : (
              <>
                <Fingerprint className="w-4 h-4 text-slate-950" />
                <span>Unlock with Fingerprint</span>
              </>
            )}
          </button>

          {/* Fallback to device screen lock */}
          <button
            type="button"
            disabled={isAuthenticating}
            onClick={handleTriggerAuth}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white text-xs font-bold border border-slate-700 transition-colors flex items-center justify-center gap-2"
          >
            <KeyRound className="w-3.5 h-3.5 text-slate-400" />
            <span>Use Device Screen Lock / Passcode</span>
          </button>
        </div>

        {/* Non-custodial Security Rule Reminder */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
          <span>Crypto transactions still require your wallet's approval</span>
        </div>
      </div>
    </div>
  );
};
