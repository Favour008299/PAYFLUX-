/**
 * PayFlux Platform Configuration
 * Purely public constants and configurations (no private keys or secrets).
 */

export const PAYFLUX_PLATFORM_FEE_POL = 0.1; // 0.1 POL fixed fee per transaction
export const PAYFLUX_PLATFORM_FEE_DISPLAY = '0.1 POL';
export const PAYFLUX_PLATFORM_FEE_USD = 0.10; // legacy compatibility fallback

// Configured public treasury wallet address for PayFlux platform revenue collection & admin (Fixed Polygon Revenue Wallet)
export const PAYFLUX_TREASURY_ADDRESS: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PAYFLUX_TREASURY_ADDRESS) ||
  (typeof process !== 'undefined' && process.env?.VITE_PAYFLUX_TREASURY_ADDRESS) ||
  '0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD';

// Configured public PayFlux Atomic Router address on Polygon PoS Mainnet (One confirmation atomic swap/pay + fee)
export const DEFAULT_PAYFLUX_ROUTER_ADDRESS: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PAYFLUX_ROUTER_ADDRESS) ||
  (typeof process !== 'undefined' && process.env?.VITE_PAYFLUX_ROUTER_ADDRESS) ||
  '';

// Authorized Admin Wallets for Backend & API Level Verification
export const AUTHORIZED_ADMIN_ADDRESSES: string[] = [
  '0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD'.toLowerCase(),
  '0x249cA82617eC3DfB2589c4c17ab7EC9765350a18'.toLowerCase(),
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'.toLowerCase(),
];

export function isAuthorizedAdmin(address?: string | null): boolean {
  if (!address) return false;
  return AUTHORIZED_ADMIN_ADDRESSES.includes(address.toLowerCase());
}

// Supported merchant payout currencies & fiat conversion rates
export const SUPPORTED_FIAT_CURRENCIES: Record<string, { symbol: string; rate: number; label: string }> = {
  NGN: { symbol: '₦', rate: 1520.0, label: 'Nigerian Naira (NGN)' },
  USD: { symbol: '$', rate: 1.0, label: 'US Dollar (USD)' },
  EUR: { symbol: '€', rate: 0.92, label: 'Euro (EUR)' },
  GBP: { symbol: '£', rate: 0.79, label: 'British Pound (GBP)' },
  JPY: { symbol: '¥', rate: 154.5, label: 'Japanese Yen (JPY)' },
  AUD: { symbol: 'A$', rate: 1.54, label: 'Australian Dollar (AUD)' },
  CAD: { symbol: 'C$', rate: 1.38, label: 'Canadian Dollar (CAD)' },
};

export interface MerchantProfile {
  merchantName: string;
  productName: string;
  priceAmount: number;
  currency: string;
  receivingAsset: string; // e.g. 'VERSE', 'POL', 'USDT', 'USDC', 'ETH'
  receivingNetwork: 'polygon' | 'ethereum';
  walletAddress: string;
  updatedAt: number;
}

