import jsQR from 'jsqr';
import { parseQRPaymentData, ParsedQRPayment } from './qrParser';

interface DecodeResult {
  success: boolean;
  rawData?: string;
  parsed?: ParsedQRPayment;
  error?: string;
}

/**
 * High-performance, multi-pass QR code decoder for image files and image elements.
 * Employs native BarcodeDetector if supported, followed by multi-scale jsQR passes,
 * image normalization, and binarization passes to reliably read phone photos,
 * screenshots, downloaded images, and low-contrast codes.
 */
export async function decodeQRCodeFromImageFile(file: File | Blob): Promise<DecodeResult> {
  try {
    const objectUrl = URL.createObjectURL(file);
    const img = await loadImageFromUrl(objectUrl);
    URL.revokeObjectURL(objectUrl);

    return await decodeQRCodeFromImageElement(img);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Could not process image: ${message}`,
    };
  }
}

/**
 * Decodes QR code from an HTMLImageElement using multiple strategies
 */
export async function decodeQRCodeFromImageElement(img: HTMLImageElement): Promise<DecodeResult> {
  // Strategy 1: Native BarcodeDetector (Hardware accelerated, ultra-fast & accurate)
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const BarcodeDetectorClass = (window as unknown as { BarcodeDetector: new (opts?: { formats: string[] }) => { detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      const detector = new BarcodeDetectorClass({ formats: ['qr_code'] });
      const barcodes = await detector.detect(img);
      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
        const raw = barcodes[0].rawValue.trim();
        const parsed = parseQRPaymentData(raw);
        return {
          success: parsed.isValid,
          rawData: raw,
          parsed,
          error: parsed.isValid ? undefined : parsed.error,
        };
      }
    } catch (e) {
      console.warn('[QRReader] Native BarcodeDetector pass failed, falling back to jsQR:', e);
    }
  }

  // Strategy 2: Multi-resolution jsQR passes
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      success: false,
      error: 'Could not create canvas 2D context for image analysis.',
    };
  }

  const originalWidth = img.naturalWidth || img.width;
  const originalHeight = img.naturalHeight || img.height;

  if (originalWidth <= 0 || originalHeight <= 0) {
    return {
      success: false,
      error: 'Invalid image dimensions.',
    };
  }

  // Define target scale sizes in order of highest detection probability for phone photos
  const targetMaxDimensions = [800, 1200, 500, Math.min(2400, originalWidth)];

  for (const maxDim of targetMaxDimensions) {
    const scale = Math.min(1, maxDim / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);

    // Pass A: standard jsQR with attemptBoth inversion
    const code = jsQR(imgData.data, width, height, {
      inversionAttempts: 'attemptBoth',
    });

    if (code && code.data) {
      const raw = code.data.trim();
      const parsed = parseQRPaymentData(raw);
      return {
        success: parsed.isValid,
        rawData: raw,
        parsed,
        error: parsed.isValid ? undefined : parsed.error,
      };
    }
  }

  // Strategy 3: Contrast enhancement & binarization pass
  try {
    const testDim = 800;
    const scale = Math.min(1, testDim / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Apply high-contrast grayscale + adaptive threshold
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      sum += gray;
    }
    const avg = sum / (data.length / 4);
    const threshold = avg * 0.95;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const val = gray < threshold ? 0 : 255;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }

    const contrastCode = jsQR(data, width, height, {
      inversionAttempts: 'attemptBoth',
    });

    if (contrastCode && contrastCode.data) {
      const raw = contrastCode.data.trim();
      const parsed = parseQRPaymentData(raw);
      return {
        success: parsed.isValid,
        rawData: raw,
        parsed,
        error: parsed.isValid ? undefined : parsed.error,
      };
    }
  } catch (e) {
    console.warn('[QRReader] Binarization pass notice:', e);
  }

  return {
    success: false,
    error: 'No valid QR code could be detected in this image. Please ensure the QR code is clearly visible and well-lit.',
  };
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image file.'));
    img.src = url;
  });
}
