import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  X,
  RefreshCw,
  AlertCircle,
  Upload,
  CheckCircle2,
  Sparkles,
  SwitchCamera,
  QrCode,
  Loader2,
  ImageIcon
} from 'lucide-react';
import jsQR from 'jsqr';
import { parseQRPaymentData, ParsedQRPayment } from '../utils/qrParser';
import { decodeQRCodeFromImageFile } from '../utils/qrReader';
import { shortenAddress } from '../utils/crypto';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (result: ParsedQRPayment) => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedResult, setScannedResult] = useState<ParsedQRPayment | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Stop camera helper
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  }, [stream]);

  // Start camera stream
  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    setUploadError(null);
    setScannedResult(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera access is not supported by your browser or environment. You can upload an image containing a QR code instead.');
      setHasCameraPermission(false);
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);
      setHasCameraPermission(true);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS Safari
        await videoRef.current.play();
        setIsScanning(true);
      }
    } catch (err: unknown) {
      console.warn('Camera start error:', err);
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please grant camera access in your browser settings or upload a QR image.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraError('No camera found on your device. Please upload a QR code image.');
      } else {
        setCameraError('Unable to open camera stream in this frame. Please allow camera access or upload an image.');
      }
      setHasCameraPermission(false);
    }
  }, [facingMode, stopCamera]);

  // Handle open / close lifecycle
  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      setScannedResult(null);
      setCameraError(null);
      setUploadError(null);
      setIsProcessingFile(false);
    }

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  // Audio beep feedback upon detection
  const playScanBeep = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch {
      // AudioContext might be blocked or unavailable
    }
  };

  // Continuous live camera frame scanning loop
  useEffect(() => {
    let animationFrameId: number;

    const scanFrame = () => {
      if (!isScanning || !videoRef.current || !canvasRef.current) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx && canvas.width > 0 && canvas.height > 0) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });

          if (code && code.data) {
            const parsed = parseQRPaymentData(code.data);
            if (parsed.isValid) {
              playScanBeep();
              setScannedResult(parsed);
              setIsScanning(false);
              stopCamera();

              setTimeout(() => {
                onScanSuccess(parsed);
                onClose();
              }, 400);
              return;
            }
          }
        }
      }

      animationFrameId = requestAnimationFrame(scanFrame);
    };

    if (isScanning) {
      animationFrameId = requestAnimationFrame(scanFrame);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isScanning, onScanSuccess, onClose, stopCamera]);

  // Decode file helper (supports both input select & drag-and-drop)
  const processImageFile = async (file: File) => {
    if (!file) return;
    setUploadError(null);
    setIsProcessingFile(true);

    try {
      const result = await decodeQRCodeFromImageFile(file);

      if (result.success && result.parsed) {
        playScanBeep();
        setScannedResult(result.parsed);
        setIsScanning(false);
        stopCamera();

        setTimeout(() => {
          onScanSuccess(result.parsed!);
          onClose();
        }, 400);
      } else {
        setUploadError(result.error || 'No valid QR code could be found in this image. Please try a clearer picture.');
      }
    } catch (err: unknown) {
      console.error('[QRScannerModal] Image decode failure:', err);
      setUploadError('Failed to read image file. Please upload a standard PNG, JPEG, or WebP image.');
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Decode from file upload input change
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processImageFile(file);
    } else if (file) {
      setUploadError('Please drop an image file (PNG, JPG, WebP, etc.).');
    }
  };

  const handleTriggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleToggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  if (!isOpen) return null;

  return (
    <div
      id="qr-scanner-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">Scan Merchant QR Code</h2>
              <p className="text-[11px] text-slate-400">Camera scanning or instant image upload</p>
            </div>
          </div>
          <button
            id="close-qr-scanner-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hidden Canvas for Frame Processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Scanner Viewport */}
        <div
          className={`relative w-full aspect-square bg-black overflow-hidden flex items-center justify-center transition-all ${
            isDraggingFile ? 'ring-4 ring-cyan-500 ring-inset' : ''
          }`}
        >
          {/* Video element */}
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />

          {/* Drag & drop active state */}
          {isDraggingFile && (
            <div className="absolute inset-0 bg-cyan-950/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
              <div className="w-16 h-16 rounded-3xl bg-cyan-500/20 border border-cyan-400 text-cyan-300 flex items-center justify-center mb-3 animate-bounce">
                <Upload className="w-8 h-8" />
              </div>
              <p className="text-sm font-black text-white">Drop QR Image Here</p>
              <p className="text-xs text-cyan-300 mt-1">We will automatically decode and parse the payment details</p>
            </div>
          )}

          {/* Processing Upload State */}
          {isProcessingFile && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
              <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mb-3" />
              <p className="text-sm font-bold text-white">Analyzing QR Image...</p>
              <p className="text-xs text-slate-400 mt-1">Scanning across multiple resolution passes</p>
            </div>
          )}

          {/* Viewfinder Target Overlay */}
          {!cameraError && !uploadError && !isProcessingFile && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8">
              <div className="relative w-64 h-64 border-2 border-cyan-400/80 rounded-3xl overflow-hidden shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]">
                {/* 4 Corner Accents */}
                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-cyan-400 rounded-tl-xl" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-cyan-400 rounded-tr-xl" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-cyan-400 rounded-bl-xl" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-cyan-400 rounded-br-xl" />

                {/* Animated Laser Scan Line */}
                {isScanning && (
                  <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_rgba(6,182,212,0.9)] animate-pulse top-1/2 -translate-y-1/2" />
                )}
              </div>
            </div>
          )}

          {/* Success Overlay when detected */}
          {scannedResult && (
            <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center animate-in zoom-in-90">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 mb-3 shadow-lg shadow-emerald-500/30">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <p className="text-sm font-extrabold text-white">Merchant QR Detected!</p>
              {scannedResult.merchantName && (
                <p className="text-xs font-bold text-emerald-300 mt-1">
                  {scannedResult.merchantName}
                </p>
              )}
              {scannedResult.address && (
                <p className="text-xs font-mono text-cyan-300 mt-0.5">
                  {shortenAddress(scannedResult.address, 6)}
                </p>
              )}
            </div>
          )}

          {/* Upload Error Overlay */}
          {uploadError && !scannedResult && (
            <div className="absolute inset-0 p-6 bg-slate-950/95 backdrop-blur-md z-20 flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in">
              <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-white mb-1">Image Detection Notice</p>
                <p className="text-[11px] text-slate-300 leading-relaxed px-2">{uploadError}</p>
              </div>

              <div className="flex flex-col gap-2 w-full max-w-xs">
                <button
                  onClick={handleTriggerFileInput}
                  className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-cyan-950/30"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Choose Another Image</span>
                </button>
                {hasCameraPermission && (
                  <button
                    onClick={() => {
                      setUploadError(null);
                      startCamera();
                    }}
                    className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Return to Camera</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Camera Error or Denied State */}
          {cameraError && !uploadError && (
            <div className="absolute inset-0 p-6 bg-slate-950 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-white mb-1">Camera Not Available</p>
                <p className="text-[11px] text-slate-400 leading-relaxed px-2">{cameraError}</p>
              </div>

              <div className="flex flex-col gap-2 w-full max-w-xs">
                <button
                  onClick={startCamera}
                  className="py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-2 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Camera</span>
                </button>
                <button
                  onClick={handleTriggerFileInput}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Upload QR Image File</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between gap-3 text-xs">
          <button
            onClick={handleToggleFacingMode}
            disabled={!hasCameraPermission}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40"
          >
            <SwitchCamera className="w-4 h-4 text-cyan-400" />
            <span>Flip Camera</span>
          </button>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.png,.jpg,.jpeg,.webp,.svg,.bmp,.heic"
            className="hidden"
            onChange={handleFileUpload}
          />

          <button
            id="qr-modal-upload-image-btn"
            onClick={handleTriggerFileInput}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 border border-cyan-500/40 text-cyan-300 font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4 text-cyan-400" />
            <span>Upload Image</span>
          </button>
        </div>
      </div>
    </div>
  );
};
