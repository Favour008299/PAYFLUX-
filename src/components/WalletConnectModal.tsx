import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Wallet,
  QrCode,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Zap,
  Globe,
  Smartphone,
  ExternalLink,
  CheckCircle2,
  Download,
  LogOut,
  Loader2,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { openAppKitModal } from '../hooks/useAppKit';
import { projectId, openWalletRedirectUrl, launchBitcoinComWalletApp, wagmiAdapter } from '../config/web3';
import { NetworkType, WalletAccount } from '../types';
import { shortenAddress } from '../utils/crypto';
import { setupWalletReturnDetector, isMobileBrowser } from '../services/walletSigningService';

interface WalletConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect?: () => void;
  onCreateNewWallet: () => void;
  selectedNetwork: NetworkType;
  wallet?: WalletAccount | null;
  onDisconnect?: () => void;
}

type ConnectStage = 'idle' | 'opening_app' | 'waiting_approval' | 'verifying' | 'connected' | 'error';

export const WalletConnectModal: React.FC<WalletConnectModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  onCreateNewWallet,
  wallet,
  onDisconnect,
}) => {
  const [connectStage, setConnectStage] = useState<ConnectStage>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const timeoutRef = useRef<any>(null);

  // If wallet is connected, reflect connected stage
  useEffect(() => {
    if (wallet?.address && (connectStage === 'opening_app' || connectStage === 'waiting_approval' || connectStage === 'verifying')) {
      setConnectStage('connected');
      setStatusMessage(`Connected: ${wallet.name || 'Wallet'}`);
      const timer = setTimeout(() => {
        onClose();
        setConnectStage('idle');
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [wallet?.address, wallet?.name, connectStage, onClose]);

  // Return detector: when user returns from Bitcoin.com Wallet app back to browser tab
  useEffect(() => {
    if (!isOpen) return;

    const cleanup = setupWalletReturnDetector(() => {
      if (connectStage === 'opening_app' || connectStage === 'waiting_approval') {
        setConnectStage('verifying');
        setStatusMessage('Resuming connection check...');

        // Check if wagmi or wallet is connected
        const currentConn = wagmiAdapter?.wagmiConfig?.state?.current;
        if (currentConn || wallet?.address) {
          setConnectStage('connected');
          setStatusMessage('Connected successfully!');
          setTimeout(() => {
            onClose();
            setConnectStage('idle');
          }, 1000);
        } else {
          // If not yet connected, return to waiting approval with clear prompt
          setTimeout(() => {
            setConnectStage('waiting_approval');
            setStatusMessage('Waiting for approval in Bitcoin.com Wallet');
          }, 1500);
        }
      }
    });

    return () => cleanup();
  }, [isOpen, connectStage, wallet?.address, onClose]);

  // Clear timers on unmount or close
  useEffect(() => {
    if (!isOpen) {
      setConnectStage('idle');
      setStatusMessage('');
      setErrorMessage('');
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Connect to Bitcoin.com Wallet app & initiate WalletConnect pairing
  const handleConnectBitcoinComWallet = async () => {
    onConnect?.();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('payflux_explicitly_disconnected');
      try {
        localStorage.setItem('payflux_connected_wallet_name', 'Bitcoin.com Wallet');
      } catch (_) {}
    }

    setConnectStage('opening_app');
    setStatusMessage('Opening Bitcoin.com Wallet App...');

    try {
      if (isMobileBrowser()) {
        launchBitcoinComWalletApp();
      }
      await openAppKitModal('Connect');
      setConnectStage('waiting_approval');
      setStatusMessage('Waiting for approval in Bitcoin.com Wallet');

      // Set a fallback timer so the user is not left stuck indefinitely
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (!wallet?.address) {
          setStatusMessage('Still waiting for approval in Bitcoin.com Wallet. Tap below to re-open.');
        }
      }, 8000);
    } catch (err: any) {
      console.error('Error opening WalletConnect modal:', err);
      setConnectStage('error');
      setErrorMessage(err?.message || 'Failed to open wallet connection.');
    }
  };

  const handleOpenWalletConnect = async (view?: 'Connect' | 'Networks' | 'AllWallets') => {
    onConnect?.();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('payflux_explicitly_disconnected');
    }
    onClose();
    try {
      await openAppKitModal(view || 'Connect');
    } catch (err) {
      console.error('Error opening WalletConnect modal:', err);
    }
  };

  const handleRetryConnection = () => {
    setConnectStage('idle');
    setErrorMessage('');
    handleConnectBitcoinComWallet();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="wallet-connect-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150 relative"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">
                {wallet ? 'Wallet Connection' : 'Connect Wallet'}
              </h3>
              <p className="text-[11px] text-slate-400">PayFlux & Multi-Chain Wallet Connect</p>
            </div>
          </div>
          <button
            id="close-connect-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* If Wallet Already Connected: Show active connection card with 1-click Disconnect */}
        {wallet && (
          <div className="mt-3 p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white">{wallet.name}</span>
                  <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">
                    Active
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  {shortenAddress(wallet.address, 4)}
                </div>
              </div>
            </div>
            {onDisconnect && (
              <button
                id="modal-disconnect-wallet-btn"
                onClick={() => {
                  onDisconnect();
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-xs font-bold transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            )}
          </div>
        )}

        {/* Dedicated Progress Card when Bitcoin.com Wallet connection is in-flight */}
        {(connectStage === 'opening_app' || connectStage === 'waiting_approval' || connectStage === 'verifying') && (
          <div className="mt-3 p-4 rounded-2xl bg-slate-950 border border-emerald-500/40 text-left space-y-3 animate-in fade-in">
            {/* Step Progress Tracker */}
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-800">
              <span className="flex items-center gap-1 text-emerald-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>1. Open Wallet</span>
              </span>
              <span>→</span>
              <span className={connectStage === 'waiting_approval' || connectStage === 'verifying' ? 'text-cyan-400 font-bold' : 'text-slate-600'}>
                2. Approve
              </span>
              <span>→</span>
              <span className={connectStage === 'verifying' ? 'text-purple-400 font-bold' : 'text-slate-600'}>
                3. Connect
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-white">
                  {connectStage === 'opening_app' && 'Launching Bitcoin.com Wallet...'}
                  {connectStage === 'waiting_approval' && 'Waiting for Approval in App'}
                  {connectStage === 'verifying' && 'Verifying Active Connection...'}
                </div>
                <div className="text-[11px] text-slate-400 leading-snug">
                  {statusMessage || 'Please approve the connection request in Bitcoin.com Wallet.'}
                </div>
              </div>
            </div>

            {/* Quick Actions while waiting */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => launchBitcoinComWalletApp()}
                className="flex-1 py-2 px-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Re-open Bitcoin.com Wallet</span>
              </button>
              <button
                type="button"
                onClick={() => setConnectStage('idle')}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Connected Success Banner */}
        {connectStage === 'connected' && (
          <div className="mt-3 p-3.5 rounded-2xl bg-emerald-950/70 border border-emerald-500/60 flex items-center gap-3 text-emerald-300 animate-in zoom-in-95">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="text-xs font-bold">Wallet successfully connected! Resuming PayFlux...</div>
          </div>
        )}

        {/* Error Notice with Try Again Option */}
        {connectStage === 'error' && (
          <div className="mt-3 p-3.5 rounded-2xl bg-rose-950/60 border border-rose-500/50 space-y-2 text-left animate-in fade-in">
            <div className="flex items-center gap-2 text-rose-300 text-xs font-bold">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>Connection Notice</span>
            </div>
            <p className="text-[11px] text-rose-200/90 leading-snug">
              {errorMessage || 'Connection request was cancelled or timed out in Bitcoin.com Wallet.'}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRetryConnection}
                className="flex-1 py-2 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
              <button
                type="button"
                onClick={() => setConnectStage('idle')}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Wallet Options List */}
        {connectStage === 'idle' && (
          <div className="py-3.5 space-y-2.5">
            {/* 1. Bitcoin.com Wallet (Primary Auto-Redirect) */}
            <button
              id="connect-bitcoin-com-wallet-btn"
              onClick={handleConnectBitcoinComWallet}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-emerald-500/20 via-teal-500/15 to-transparent border border-emerald-500/50 hover:border-emerald-400 hover:bg-emerald-500/25 transition-all text-left group shadow-lg shadow-emerald-950/40"
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white font-black text-lg shadow-md shadow-emerald-500/30 group-hover:scale-105 transition-transform flex-shrink-0">
                  <span className="font-extrabold tracking-tighter">₿</span>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 font-extrabold text-sm text-white">
                    <span>Bitcoin.com Wallet</span>
                    <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      App Direct
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Smooth connection & auto-return to PayFlux
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-emerald-400 group-hover:translate-x-1 transition-transform">
                <span className="text-xs font-bold hidden sm:inline-block">Connect</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </button>

            {/* 2. WalletConnect / QR Code (Multi-Wallet) */}
            <button
              id="connect-walletconnect-main-btn"
              onClick={() => handleOpenWalletConnect('Connect')}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-cyan-500/60 hover:bg-slate-800/60 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white font-black text-sm shadow-md shadow-cyan-500/20 group-hover:scale-105 transition-transform flex-shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-sm text-white">
                    <span>WalletConnect / QR Code</span>
                    <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                      300+ Wallets
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    MetaMask, Trust, Coinbase, Rainbow & others
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-cyan-400 group-hover:translate-x-1 transition-transform" />
            </button>

            {/* 3. All Wallets Browser Modal Trigger */}
            <button
              id="connect-all-wallets-btn"
              onClick={() => handleOpenWalletConnect('AllWallets')}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/50 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-cyan-400 font-black text-xs shadow-md">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-xs text-white">Explore All Wallets & Extensions</div>
                  <p className="text-[10px] text-slate-400">Browser extensions, Hardware & Mobile</p>
                </div>
              </div>
              <QrCode className="w-4 h-4 text-slate-400 group-hover:text-cyan-400 transition-colors" />
            </button>

            {/* 4. Network Switcher View */}
            <button
              id="connect-switch-network-btn"
              onClick={() => handleOpenWalletConnect('Networks')}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/50 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 font-black text-xs">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-xs text-white">Select Blockchain Network</div>
                  <p className="text-[10px] text-slate-400">Polygon, Ethereum, BNB, Avalanche, Base</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        )}

        {/* Bitcoin.com App Store & Google Play Links for quick install */}
        <div className="mt-1 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 px-1">
          <span className="flex items-center gap-1 text-slate-400">
            <Download className="w-3 h-3 text-emerald-400" />
            <span>Get App:</span>
          </span>
          <div className="flex items-center gap-3 font-medium">
            <a
              href="https://apps.apple.com/app/bitcoin-wallet-by-bitcoin-com/id1252903728"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline flex items-center gap-0.5"
            >
              <span>iOS Store</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <span>•</span>
            <a
              href="https://play.google.com/store/apps/details?id=com.bitcoin.mwallet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline flex items-center gap-0.5"
            >
              <span>Google Play</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>

        {/* Non-custodial security note */}
        <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400 justify-center">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          <span>Real cryptographic signatures • 100% Non-custodial</span>
        </div>
      </div>
    </div>
  );
};

