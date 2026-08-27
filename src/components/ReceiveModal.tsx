import React, { useState } from 'react';
import {
  X,
  QrCode,
  Copy,
  Check,
  Share2,
  AlertCircle,
  Wallet,
} from 'lucide-react';
import { useAccount } from 'wagmi';
import { Token, WalletAccount } from '../types';
import { INITIAL_TOKENS } from '../data/tokens';
import { TokenIcon } from './TokenIcon';
import { QRCodeDisplay } from './QRCodeDisplay';

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  wallet?: WalletAccount | null;
  onOpenConnectModal?: () => void;
  onShareReceipt?: () => void;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  isOpen,
  onClose,
  tokens,
  wallet,
  onOpenConnectModal,
}) => {
  const { address: connectedWagmiAddress, isConnected: isWagmiConnected } = useAccount();

  // Active address is ALWAYS dynamically derived from the real connected wallet
  const activeAddress = (isWagmiConnected && connectedWagmiAddress) ? connectedWagmiAddress : (wallet?.address || '');
  const hasConnectedWallet = Boolean(activeAddress && activeAddress.startsWith('0x'));

  const [selectedToken, setSelectedToken] = useState<Token>(() => tokens[0] || INITIAL_TOKENS[0]);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!activeAddress) return;
    navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPaymentLink = () => {
    if (!activeAddress) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://verseswap.app';
    const link = `${origin}/pay?token=${selectedToken.symbol}&to=${activeAddress}&network=${selectedToken.network}`;
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="receive-crypto-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150 relative max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <QrCode className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-left">
              <h3 className="font-extrabold text-base text-white">Receive Crypto</h3>
              <p className="text-[11px] text-slate-400">
                {hasConnectedWallet ? 'Deposit funds into your connected wallet' : 'Connect wallet to generate deposit address'}
              </p>
            </div>
          </div>
          <button
            id="close-receive-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* IF NO WALLET CONNECTED: State with prompt to connect */}
        {!hasConnectedWallet ? (
          <div className="py-8 px-2 text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400 shadow-lg shadow-cyan-950/50">
              <Wallet className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h4 className="text-lg font-bold text-white">Connect your wallet to receive crypto.</h4>
              <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                Connect your Web3 wallet to display your real receiving address and custom QR code for VERSE, POL, ETH, USDT, USDC, and other supported tokens.
              </p>
            </div>

            <button
              id="receive-connect-wallet-prompt-btn"
              onClick={() => {
                onClose();
                onOpenConnectModal?.();
              }}
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2"
            >
              <Wallet className="w-4 h-4" />
              <span>Connect Wallet</span>
            </button>
          </div>
        ) : (
          /* WALLET CONNECTED: Real receiving address & QR code */
          <div className="space-y-4">
            {/* Token Selector Filter Buttons */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Select Asset</span>
                <span className="text-[10px] text-cyan-400 font-semibold">{selectedToken.networkName}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {tokens.slice(0, 7).map((t) => {
                  const tokenKey = t.id || `${t.symbol}-${t.network}`;
                  const isSelected = selectedToken.id === t.id || (selectedToken.symbol === t.symbol && selectedToken.network === t.network);
                  return (
                    <button
                      key={tokenKey}
                      onClick={() => setSelectedToken(t)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all shrink-0 ${
                        isSelected
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-sm'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <TokenIcon token={t} size="xs" />
                      <span>{t.symbol}</span>
                      <span className="text-[9px] text-slate-500">
                        {t.network === 'polygon' ? 'POL' : t.network === 'ethereum' ? 'ETH' : t.network}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* High-Contrast Crisp QR Code of the Real Connected Wallet Address */}
            <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-slate-950 border border-slate-800/80">
              <div className="mb-2">
                <QRCodeDisplay
                  value={activeAddress}
                  size={180}
                  showDownloadButton={true}
                  altText={`Receive ${selectedToken.symbol} (${selectedToken.networkName}) QR Code`}
                />
              </div>
              <div className="text-[11px] font-medium text-slate-400 mt-1 flex items-center gap-1">
                <span>Scan with any Web3 wallet or camera</span>
              </div>
            </div>

            {/* Address Card with Instant Copy */}
            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 text-left">
              <div className="overflow-hidden flex-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span>Connected Wallet Address</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                    Live
                  </span>
                </div>
                <div className="text-xs font-mono font-bold text-cyan-300 break-all select-all mt-0.5">
                  {activeAddress}
                </div>
              </div>
              <button
                id="receive-copy-address-btn"
                onClick={handleCopy}
                className="p-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all shadow-md shrink-0 flex items-center gap-1 text-xs"
                title="Copy Address"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Quick Actions Row */}
            <div className="grid grid-cols-2 gap-2">
              <button
                id="copy-address-text-btn"
                onClick={handleCopy}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors flex items-center justify-center gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
                <span>{copied ? 'Copied to Clipboard' : 'Copy Full Address'}</span>
              </button>
              <button
                id="copy-payment-link-btn"
                onClick={handleCopyPaymentLink}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors flex items-center justify-center gap-1.5"
              >
                {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 text-cyan-400" />}
                <span>{linkCopied ? 'Pay Link Copied!' : 'Share Pay Link'}</span>
              </button>
            </div>

            {/* Network Safeguard & Asset Guidance */}
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-left text-xs text-amber-300">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                Send only <strong className="text-amber-200">{selectedToken.name} ({selectedToken.symbol})</strong> on the <strong className="text-amber-200">{selectedToken.networkName}</strong> network to this address. Your EVM wallet receives all Polygon & Ethereum tokens at this address.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

