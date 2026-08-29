import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  KeyRound,
  AlertCircle,
  Sparkles,
  ArrowRight,
  UserCheck,
  CheckCircle2,
  HelpCircle
} from 'lucide-react';
import {
  signInAdminWithGoogle,
  signInAdminWithEmail,
  createAdminWithEmail,
  PRIMARY_ADMIN_EMAIL
} from '../services/adminAuthService';

interface AdminLoginCardProps {
  onSuccess?: () => void;
}

export const AdminLoginCard: React.FC<AdminLoginCardProps> = ({ onSuccess }) => {
  const [authMode, setAuthMode] = useState<'google' | 'email_login' | 'email_signup'>('google');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await signInAdminWithGoogle();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Google Sign In Error:', err);
      setErrorMsg(err?.message || 'Failed to sign in with Google.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (authMode === 'email_signup') {
        await createAdminWithEmail(email, password);
        setSuccessMsg('Account created successfully and verifying admin credentials.');
      } else {
        await signInAdminWithEmail(email, password);
      }
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Email Auth Error:', err);
      let friendly = err?.message || 'Authentication failed.';
      if (friendly.includes('auth/invalid-credential') || friendly.includes('auth/wrong-password')) {
        friendly = 'Invalid email or password. If this is your first time, click "Create Admin Account" below.';
      } else if (friendly.includes('auth/email-already-in-use')) {
        friendly = 'Account already exists. Please select "Sign In".';
      }
      setErrorMsg(friendly);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-slate-900/95 backdrop-blur-2xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="text-center space-y-3 mb-6 relative">
        <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-purple-600/30 to-cyan-500/30 border border-purple-500/40 text-cyan-300 shadow-inner">
          <ShieldCheck className="w-8 h-8 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            PayFlux Admin Gateway
          </h2>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Restricted zone. Authentication required to access platform revenue & global telemetry.
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono">
          <Lock className="w-3 h-3 text-purple-400" />
          <span>Authorized: <strong className="text-cyan-300">{PRIMARY_ADMIN_EMAIL}</strong></span>
        </div>
      </div>

      {/* Error / Success Feedback */}
      {errorMsg && (
        <div className="mb-5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-rose-300 text-xs animate-in fade-in duration-200">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="mb-5 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2.5 text-emerald-300 text-xs animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Google One-Click Sign In (Recommended) */}
      <div className="space-y-3 mb-6">
        <button
          id="admin-google-signin-btn"
          type="button"
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-white/5 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>{isLoading ? 'Authenticating...' : 'Sign In with Google Admin'}</span>
        </button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-800" />
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Or Email Password</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>
      </div>

      {/* Email / Password Form */}
      <form onSubmit={handleEmailAuth} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Admin Email Address
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="admin-email-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="favournosakhare110@gmail.com"
              className="w-full bg-slate-950/80 border border-slate-800 focus:border-cyan-500 focus:outline-none rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-white placeholder-slate-600 font-medium"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Password
          </label>
          <div className="relative">
            <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="admin-password-input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-slate-950/80 border border-slate-800 focus:border-cyan-500 focus:outline-none rounded-xl py-2.5 pl-10 pr-3.5 text-xs text-white placeholder-slate-600 font-medium"
            />
          </div>
        </div>

        <button
          id="admin-email-submit-btn"
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 hover:from-purple-500 hover:to-cyan-400 text-slate-950 font-extrabold text-xs transition-all shadow-md shadow-purple-950/50 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <span>
            {isLoading
              ? 'Processing...'
              : authMode === 'email_signup'
              ? 'Create & Authenticate Admin'
              : 'Sign In to Admin Portal'}
          </span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </form>

      {/* Switch between Sign In / Create Account for email */}
      <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        {authMode === 'email_signup' ? (
          <button
            type="button"
            onClick={() => setAuthMode('email_login')}
            className="text-cyan-400 hover:text-cyan-300 font-bold"
          >
            Already have an admin password? Sign In
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setAuthMode('email_signup')}
            className="text-cyan-400 hover:text-cyan-300 font-bold"
          >
            First time logging in with email? Set password
          </button>
        )}
      </div>
    </div>
  );
};
