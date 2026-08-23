import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { RefreshCw, Download, Check } from 'lucide-react';

interface QRCodeDisplayProps {
  value: string;
  size?: number;
  className?: string;
  showDownloadButton?: boolean;
  altText?: string;
}

/**
 * High-reliability QR Code component
 * Generates an ultra-crisp, high-contrast, standard-compliant QR code image via the official qrcode engine.
 * Immune to CSS currentColor inheritance bugs or SVG clipping issues.
 */
export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({
  value,
  size = 200,
  className = '',
  showDownloadButton = false,
  altText = 'Payment QR Code',
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    async function generateQR() {
      if (!value || !value.trim()) {
        setDataUrl('');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const url = await QRCode.toDataURL(value.trim(), {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: size * 2, // 2x for retina display crispness
          color: {
            dark: '#000000', // Pure black modules
            light: '#FFFFFF', // Pure white background
          },
        });

        if (!isCancelled) {
          setDataUrl(url);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[QRCodeDisplay] Generation error:', err);
        if (!isCancelled) {
          setError('Failed to generate QR code');
          setIsLoading(false);
        }
      }
    }

    generateQR();

    return () => {
      isCancelled = true;
    };
  }, [value, size]);

  const handleDownload = () => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `payment-qr-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  };

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div
        className="relative bg-white p-3 rounded-2xl shadow-xl border-2 border-slate-200 flex items-center justify-center overflow-hidden"
        style={{ width: size + 24, height: size + 24 }}
      >
        {isLoading && (
          <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center text-slate-800 gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-cyan-600" />
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500">Generating QR...</span>
          </div>
        )}

        {error ? (
          <div className="text-center p-3 text-rose-600 text-xs font-bold">
            {error}
          </div>
        ) : dataUrl ? (
          <img
            src={dataUrl}
            alt={altText}
            width={size}
            height={size}
            className="w-full h-full object-contain block select-none pointer-events-none"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <div className="text-slate-400 text-xs font-semibold">No data</div>
        )}
      </div>

      {showDownloadButton && dataUrl && (
        <button
          type="button"
          onClick={handleDownload}
          className="mt-2 text-[11px] font-bold text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1"
        >
          {downloaded ? <Check className="w-3 h-3 text-emerald-400" /> : <Download className="w-3 h-3" />}
          <span>{downloaded ? 'Saved PNG' : 'Download QR Image'}</span>
        </button>
      )}
    </div>
  );
};
