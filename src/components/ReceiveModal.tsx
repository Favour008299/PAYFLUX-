import React, { useState, useMemo } from 'react';
import {
  X,
  QrCode,
  Copy,
  Check,
  Share2,
  AlertCircle,
  Wallet,
  ExternalLink,
} from 'lucide-react';
import { Token, WalletAccount } from '../types';
import { TokenIcon } from './TokenIcon';
import { QRCodeDisplay } from './QRCodeDisplay';

export interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  wallet?: WalletAccount | null;
  onConnectWallet?: () => void;
  onShareReceipt?: () => void;
}

interface SupportedReceiveAsset {
  id: string;
  symbol: 'VERSE' | 'POL' | 'USDT';
  name: string;
  decimals: number;
  network: 'polygon';
  networkName: 'Polygon';
  contractAddress: string;
  isNative: boolean;
  iconBg: string;
  iconColor: string;
  logoUrl?: string;
}

// Strictly supported receive assets on Polygon only
const SUPPORTED_RECEIVE_ASSETS: SupportedReceiveAsset[] = [
  {
    id: 'verse-polygon',
    symbol: 'VERSE',
    name: 'Verse',
    decimals: 18,
    network: 'polygon',
    networkName: 'Polygon',
    contractAddress: '0xc708D6F2153933DAA50B2D0758955Be0A93A8FEc',
    isNative: false,
    iconBg: '#00D4FF',
    iconColor: '#031726',
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x249cA82617eC3DfB2589c4c17ab7EC9765350a18/logo.png',
  },
  {
    id: 'pol-polygon',
    symbol: 'POL',
    name: 'Polygon',
    decimals: 18,
    network: 'polygon',
    networkName: 'Polygon',
    contractAddress: '0x0000000000000000000000000000000000000000',
    isNative: true,
    iconBg: '#8247E5',
    iconColor: '#FFFFFF',
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png',
  },
  {
    id: 'usdt-polygon',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    network: 'polygon',
    networkName: 'Polygon',
    contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    isNative: false,
    iconBg: '#26A17B',
    iconColor: '#FFFFFF',
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
  },
];

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  isOpen,
  onClose,
  tokens,
  wallet,
  onConnectWallet,
}) => {
  // Always default to the first supported Polygon asset (VERSE on Polygon)
  const [selectedAsset, setSelectedAsset] = useState<SupportedReceiveAsset>(SUPPORTED_RECEIVE_ASSETS[0]);
  const [addressCopied, setAddressCopied] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);

  // Validate if wallet is genuinely connected with a real EVM address
  const isWalletConnected = Boolean(
    wallet &&
    typeof wallet.address === 'string' &&
    wallet.address.startsWith('0x') &&
    wallet.address.length === 42 &&
    wallet.address !== '0x0000000000000000000000000000000000000000'
  );
  const realAddress = isWalletConnected && wallet ? wallet.address : null;

  // Find token balance in user's token list if available
  const currentTokenInfo = useMemo(() => {
    return tokens.find(
      (t) => t.network === 'polygon' && t.symbol === selectedAsset.symbol
    );
  }, [tokens, selectedAsset]);

  if (!isOpen) return null;

  // Real PayFlux Receive QR Code value for the selected asset and connected address
  const qrCodeValue = realAddress
    ? `payflux:payment?address=${realAddress}&token=${selectedAsset.symbol}&network=polygon`
    : '';

  // Copy real wallet address to clipboard
  const handleCopyAddress = () => {
    if (!realAddress) return;
    navigator.clipboard.writeText(realAddress);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 2000);
  };

  // Open native device share sheet
  const handleSharePayLink = async () => {
    if (!realAddress) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://verseswap.app';
    const payUrl = `${origin}/pay?token=${selectedAsset.symbol}&to=${realAddress}`;

    const shareData = {
      title: `PayFlux - Pay ${selectedAsset.symbol}`,
      text: `Send ${selectedAsset.symbol} (Polygon) to my PayFlux wallet:\n${realAddress}`,
      url: payUrl,
    };

    // Tap opens the device's native sharing interface/share sheet
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
      } catch (err: any) {
        // User dismissing or cancelling the share sheet (AbortError) is expected
        if (err?.name !== 'AbortError') {
          console.warn('[Share Pay Link] Share error:', err);
        }
      }
    } else {
      // Fallback only if device browser has no native share sheet API support
      try {
        await navigator.clipboard.writeText(payUrl);
        setLinkFeedback('Link Copied!');
        setTimeout(() => setLinkFeedback(null), 2000);
      } catch (err) {
        console.warn('[Share Pay Link] Clipboard fallback notice:', err);
      }
    }
  };

  // Convert SupportedReceiveAsset to Token-like shape for TokenIcon
  const tokenForIcon: Token = {
    id: selectedAsset.id,
    symbol: selectedAsset.symbol,
    name: selectedAsset.name,
    decimals: selectedAsset.decimals,
    network: selectedAsset.network,
    networkName: selectedAsset.networkName,
    contractAddress: selectedAsset.contractAddress,
    iconBg: selectedAsset.iconBg,
    iconColor: selectedAsset.iconColor,
    logoUrl: selectedAsset.logoUrl,
    balance: currentTokenInfo?.balance || 0,
    priceUsd: currentTokenInfo?.priceUsd || 0,
    change24h: currentTokenInfo?.change24h || 0,
    isFavorite: false,
    category: 'defi',
    sparkline: [],
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="receive-crypto-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 text-center animate-in zoom-in-95 duration-150 relative max-h-[92vh] overflow-y-auto"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
              <QrCode className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-left">
              <h3 className="font-extrabold text-base text-white">Receive Crypto</h3>
              <p className="text-[11px] text-slate-400">Polygon Network Only</p>
            </div>
          </div>
          <button
            id="close-receive-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Supported Assets Filter: ONLY VERSE, POL, USDT on Polygon */}
        <div className="mb-4 text-left">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-2 px-0.5">
            <span>Select Asset</span>
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-800/50 text-purple-300 font-bold uppercase tracking-wider">
              Polygon (Chain ID: 137)
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {SUPPORTED_RECEIVE_ASSETS.map((asset) => {
              const isSelected = selectedAsset.id === asset.id;
              const assetIconToken: Token = {
                id: asset.id,
                symbol: asset.symbol,
                name: asset.name,
                decimals: asset.decimals,
                network: asset.network,
                networkName: asset.networkName,
                contractAddress: asset.contractAddress,
                iconBg: asset.iconBg,
                iconColor: asset.iconColor,
                logoUrl: asset.logoUrl,
                balance: 0,
                priceUsd: 0,
                change24h: 0,
                isFavorite: false,
                category: 'defi',
                sparkline: [],
              };

              return (
                <button
                  key={asset.id}
                  id={`select-receive-asset-${asset.symbol.toLowerCase()}`}
                  onClick={() => setSelectedAsset(asset)}
                  className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-2xl border transition-all ${
                    isSelected
                      ? 'bg-cyan-500/15 border-cyan-400 text-cyan-300 shadow-md shadow-cyan-950/50 scale-[1.02]'
                      : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <TokenIcon token={assetIconToken} size="sm" />
                  <span className="text-xs font-black mt-1.5">{asset.symbol}</span>
                  <span className="text-[9px] text-slate-500 font-medium">Polygon</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Conditional Rendering: Connected vs Unconnected State */}
        {isWalletConnected && realAddress ? (
          <>
            {/* PayFlux Receive QR Code Section */}
            <div className="flex flex-col items-center justify-center my-3 p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80">
              {/* PayFlux Receive QR Label */}
              <div className="flex flex-col items-center gap-1 mb-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-extrabold shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span>PayFlux Receive QR</span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium">
                  For PayFlux users & Web3 payments
                </span>
              </div>

              {/* Ultra-Crisp QR Code with Download PNG button */}
              <QRCodeDisplay
                value={qrCodeValue}
                size={180}
                showDownloadButton={true}
                altText={`PayFlux Receive ${selectedAsset.symbol} QR Code`}
                filename={`payflux-receive-${selectedAsset.symbol.toLowerCase()}-polygon.png`}
              />
            </div>

            {/* Real Connected Wallet Address Card */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 mb-3 text-left">
              <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">
                <span>{selectedAsset.name} Deposit Address</span>
                <span className="text-cyan-400 font-semibold lowercase">polygon</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-mono font-bold text-cyan-300 break-all select-all leading-relaxed">
                  {realAddress}
                </div>
                <button
                  id="receive-copy-address-btn"
                  onClick={handleCopyAddress}
                  className="p-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all shadow-md flex-shrink-0"
                  title="Copy Address"
                >
                  {addressCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Action Buttons: Copy Address & Native Share Pay Link */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                id="copy-address-text-btn"
                onClick={handleCopyAddress}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
              >
                {addressCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
                <span>{addressCopied ? 'Copied!' : 'Copy Address'}</span>
              </button>
              <button
                id="share-payment-link-btn"
                onClick={handleSharePayLink}
                className="py-2.5 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-cyan-500/20 active:scale-[0.98]"
              >
                <Share2 className="w-3.5 h-3.5 text-slate-950" />
                <span>{linkFeedback || 'Share Pay Link'}</span>
              </button>
            </div>
          </>
        ) : (
          /* Unconnected State: No address or QR shown, clear message and connect action */
          <div className="my-5 p-6 rounded-3xl bg-slate-950/80 border border-slate-800 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 text-cyan-400">
              <Wallet className="w-7 h-7" />
            </div>
            <h4 className="font-extrabold text-base text-white mb-1.5">
              Connect your wallet to receive crypto
            </h4>
            <p className="text-xs text-slate-400 mb-5 max-w-xs leading-relaxed">
              Connect your Web3 wallet to display your real Polygon deposit address and generate your PayFlux receive QR code.
            </p>
            {onConnectWallet && (
              <button
                id="receive-connect-wallet-btn"
                onClick={onConnectWallet}
                className="w-full max-w-xs py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-500/20 active:scale-[0.98]"
              >
                <Wallet className="w-4 h-4 text-slate-950" />
                <span>Connect Wallet</span>
              </button>
            )}
          </div>
        )}

        {/* Network Safeguard Warning */}
        <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-left text-xs text-amber-300">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <span className="text-[11px] leading-tight">
            Send only <strong className="text-amber-200">{selectedAsset.name} ({selectedAsset.symbol})</strong> on the <strong className="text-amber-200">Polygon network</strong> to this address. Sending unsupported assets or from other chains will result in permanent loss.
          </span>
        </div>
      </div>
    </div>
  );
};
