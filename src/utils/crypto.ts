import { FIAT_RATES } from '../data/tokens';

// BIP-39 compatible word dictionary subset for client-side generation
const BIP39_WORDS = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse',
  'access', 'accident', 'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act',
  'action', 'actor', 'actress', 'actual', 'adapt', 'add', 'addict', 'address', 'adjust', 'admit',
  'adult', 'advance', 'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album', 'alcohol', 'alert',
  'alien', 'all', 'alley', 'allow', 'almost', 'alone', 'alpha', 'already', 'also', 'alter',
  'always', 'amateur', 'amazing', 'among', 'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger',
  'angle', 'angry', 'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
  'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april', 'arch', 'arctic',
  'area', 'arena', 'argue', 'arm', 'armed', 'armor', 'army', 'around', 'arrange', 'arrest',
  'arrive', 'arrow', 'art', 'artefact', 'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset',
  'assist', 'assume', 'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction',
  'audit', 'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado', 'avoid', 'awake',
  'aware', 'away', 'awesome', 'awful', 'awkward', 'axis', 'baby', 'bachelor', 'bacon', 'badge',
  'bag', 'balance', 'balcony', 'ball', 'bamboo', 'banana', 'banner', 'bar', 'barely', 'bargain',
  'barrel', 'base', 'basic', 'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become'
];

/**
 * Generates a standard 12-word cryptographic recovery phrase client-side
 */
export function generateRecoveryPhrase(): string[] {
  const words: string[] = [];
  const cryptoObj = window.crypto || (window as unknown as { msCrypto: Crypto }).msCrypto;
  const randomBuffer = new Uint32Array(12);
  cryptoObj.getRandomValues(randomBuffer);

  for (let i = 0; i < 12; i++) {
    const index = randomBuffer[i] % BIP39_WORDS.length;
    words.push(BIP39_WORDS[index]);
  }
  return words;
}

/**
 * Generates a realistic mock crypto address based on network type
 */
export function generateAddress(network: string = 'ethereum'): string {
  const hexChars = '0123456789abcdefABCDEF';
  const cryptoObj = window.crypto;
  const randBytes = new Uint8Array(20);
  cryptoObj.getRandomValues(randBytes);

  if (network === 'bitcoincash') {
    let hash = '';
    for (let i = 0; i < 34; i++) {
      hash += hexChars[randBytes[i % randBytes.length] % hexChars.length].toLowerCase();
    }
    return `bitcoincash:qp${hash.substring(0, 38)}`;
  } else if (network === 'bitcoin') {
    let hash = '';
    for (let i = 0; i < 34; i++) {
      hash += hexChars[randBytes[i % randBytes.length] % hexChars.length];
    }
    return `bc1q${hash.toLowerCase().substring(0, 36)}`;
  }

  // Ethereum / Polygon format
  let ethHex = '0x';
  for (let i = 0; i < 20; i++) {
    ethHex += randBytes[i].toString(16).padStart(2, '0');
  }
  return ethHex;
}

export function generateTxHash(): string {
  const randBytes = new Uint8Array(32);
  window.crypto.getRandomValues(randBytes);
  let hash = '0x';
  for (let i = 0; i < 32; i++) {
    hash += randBytes[i].toString(16).padStart(2, '0');
  }
  return hash;
}

export function isValidEVMAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return '';
  if (address.startsWith('bitcoincash:')) {
    const clean = address.replace('bitcoincash:', '');
    return `bch:${clean.slice(0, chars + 2)}...${clean.slice(-chars)}`;
  }
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatCurrency(
  amountUsd: number | null | undefined,
  currency: string = 'USD',
  compact = false
): string {
  if (amountUsd === null || amountUsd === undefined || isNaN(amountUsd) || amountUsd < 0) {
    return 'Price unavailable';
  }

  const fiatConfig = FIAT_RATES[currency] || FIAT_RATES['USD'];
  const converted = amountUsd * fiatConfig.rate;

  if (compact && converted >= 1_000_000) {
    return `${fiatConfig.symbol}${(converted / 1_000_000).toFixed(2)}M`;
  }
  if (compact && converted >= 10_000) {
    return `${fiatConfig.symbol}${(converted / 1_000).toFixed(2)}K`;
  }

  // Micro-pricing for low-unit tokens like VERSE (e.g. $0.00002145)
  if (converted > 0 && converted < 0.0001) {
    const formatted = converted.toFixed(8).replace(/0+$/, '');
    return `${fiatConfig.symbol}${formatted}`;
  }

  if (converted < 0.01 && converted > 0) {
    return `${fiatConfig.symbol}${converted.toFixed(6)}`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency === 'NGN' ? 'NGN' : currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: converted < 1 ? 4 : 2,
    maximumFractionDigits: converted < 1 ? 4 : 2,
  }).format(converted).replace('NGN', '₦');
}

export function formatTokenPrice(
  token: { priceUsd?: number; isPriceUnavailable?: boolean },
  currency: string = 'USD'
): string {
  if (token.isPriceUnavailable || token.priceUsd === undefined || token.priceUsd === null || token.priceUsd <= 0 || isNaN(token.priceUsd)) {
    return 'Price unavailable';
  }
  return formatCurrency(token.priceUsd, currency);
}

export function formatTokenAmount(amount: number | string, decimals = 4): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num) || num === 0) return '0.00';
  if (num < 0.0001) return '< 0.0001';
  if (num > 100_000) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

import QRCode from 'qrcode';

/**
 * Standard SVG QR Code Path Generator
 * Uses the official QR standard matrix to generate accurate, scannable SVG path data.
 */
export function generateSvgQrCode(data: string, size = 180): string {
  if (!data || !data.trim()) return '';
  try {
    const qr = QRCode.create(data.trim(), { errorCorrectionLevel: 'M' });
    const modules = qr.modules;
    const matrixSize = modules.size;
    const cellSize = size / matrixSize;
    let paths = '';

    for (let r = 0; r < matrixSize; r++) {
      for (let c = 0; c < matrixSize; c++) {
        if (modules.get(r, c)) {
          const x = (c * cellSize).toFixed(2);
          const y = (r * cellSize).toFixed(2);
          const s = cellSize.toFixed(2);
          paths += `M${x},${y}h${s}v${s}h-${s}z `;
        }
      }
    }

    return paths;
  } catch (e) {
    console.error('Failed to generate QR path:', e);
    return '';
  }
}

