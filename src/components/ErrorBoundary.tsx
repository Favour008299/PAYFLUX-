import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[PayFlux Uncaught Error]:', error, errorInfo);
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleReset = () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('payflux_explicitly_disconnected');
      } catch (_) {}
      this.setState({ hasError: false, error: null });
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Something went wrong</h2>
              <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                A transient rendering error occurred. You can safely reload or recover your session.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-left">
                <p className="text-[11px] font-mono text-rose-400 break-words line-clamp-3">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                id="error-boundary-recover-btn"
                onClick={this.handleReset}
                className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4 text-cyan-400" />
                <span>Try Again</span>
              </button>
              <button
                id="error-boundary-reload-btn"
                onClick={this.handleReload}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-sm shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Page</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
