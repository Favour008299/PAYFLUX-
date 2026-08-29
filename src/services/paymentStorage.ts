import { MerchantInvoice, CustomerPaymentReceipt, PlatformAnalytics } from '../types';
import { MerchantProfile, PAYFLUX_PLATFORM_FEE_USD } from '../config/platform';

const INVOICES_KEY = 'payflux_merchant_invoices';
const CUSTOMER_RECEIPTS_KEY = 'payflux_customer_receipts';
const MERCHANT_PROFILES_KEY = 'payflux_merchant_profiles';

export function emitPaymentUpdate(invoiceId: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('payflux_payment_update', { detail: { invoiceId } }));
  }
}

export function subscribeToPaymentUpdates(callback: (invoiceId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ invoiceId: string }>;
    if (custom.detail?.invoiceId) {
      callback(custom.detail.invoiceId);
    }
  };

  window.addEventListener('payflux_payment_update', handler);
  window.addEventListener('storage', () => {
    callback('*');
  });

  return () => {
    window.removeEventListener('payflux_payment_update', handler);
  };
}

/**
 * Get all merchant invoices
 */
export function getMerchantInvoices(filterMerchantAddress?: string): MerchantInvoice[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(INVOICES_KEY);
    if (!data) return [];
    const parsed: MerchantInvoice[] = JSON.parse(data);
    const seen = new Set<string>();
    const unique: MerchantInvoice[] = [];
    for (const inv of parsed) {
      if (inv && inv.id && !seen.has(inv.id)) {
        seen.add(inv.id);
        if (
          !filterMerchantAddress ||
          inv.merchantAddress.toLowerCase() === filterMerchantAddress.toLowerCase()
        ) {
          unique.push(inv);
        }
      }
    }
    return unique;
  } catch (e) {
    console.error('Failed to load merchant invoices:', e);
    return [];
  }
}

/**
 * Get specific invoice by ID
 */
export function getInvoiceById(id: string): MerchantInvoice | null {
  const invoices = getMerchantInvoices();
  return invoices.find((inv) => inv.id === id) || null;
}

/**
 * Save or update a merchant invoice
 */
export function saveMerchantInvoice(invoice: MerchantInvoice): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getMerchantInvoices().filter((inv) => inv.id !== invoice.id);
    existing.unshift(invoice);
    localStorage.setItem(INVOICES_KEY, JSON.stringify(existing));
    emitPaymentUpdate(invoice.id);
  } catch (e) {
    console.error('Failed to save merchant invoice:', e);
  }
}

/**
 * Update the status of an existing invoice
 */
export function updateInvoiceStatus(
  id: string,
  update: Partial<MerchantInvoice>
): MerchantInvoice | null {
  const invoices = getMerchantInvoices();
  const index = invoices.findIndex((inv) => inv.id === id);
  if (index === -1) return null;

  const updated: MerchantInvoice = {
    ...invoices[index],
    ...update,
    payfluxFeeUsd: update.status === 'paid' ? (invoices[index].payfluxFeeUsd || PAYFLUX_PLATFORM_FEE_USD) : invoices[index].payfluxFeeUsd,
  };

  invoices[index] = updated;
  localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
  emitPaymentUpdate(id);
  return updated;
}

/**
 * Get customer payment receipts (scoped to customer address if provided)
 */
export function getCustomerReceipts(filterPayerAddress?: string): CustomerPaymentReceipt[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(CUSTOMER_RECEIPTS_KEY);
    if (!data) return [];
    const parsed: CustomerPaymentReceipt[] = JSON.parse(data);
    const seen = new Set<string>();
    const unique: CustomerPaymentReceipt[] = [];
    for (const r of parsed) {
      if (r && r.id && !seen.has(r.id)) {
        seen.add(r.id);
        if (
          !filterPayerAddress ||
          (r.payerAddress && r.payerAddress.toLowerCase() === filterPayerAddress.toLowerCase())
        ) {
          unique.push(r);
        }
      }
    }
    return unique;
  } catch (e) {
    console.error('Failed to load customer receipts:', e);
    return [];
  }
}

/**
 * Save customer payment receipt
 */
export function saveCustomerReceipt(receipt: CustomerPaymentReceipt): void {
  if (typeof window === 'undefined') return;
  try {
    const enriched = {
      ...receipt,
      payfluxFeeUsd: receipt.payfluxFeeUsd ?? PAYFLUX_PLATFORM_FEE_USD,
    };
    const existing = getCustomerReceipts().filter((r) => r.id !== receipt.id);
    existing.unshift(enriched);
    localStorage.setItem(CUSTOMER_RECEIPTS_KEY, JSON.stringify(existing));
  } catch (e) {
    console.error('Failed to save customer receipt:', e);
  }
}

/**
 * Save or get merchant profile for a connected wallet address
 */
export function getMerchantProfile(walletAddress: string): MerchantProfile | null {
  if (typeof window === 'undefined' || !walletAddress) return null;
  try {
    const raw = localStorage.getItem(MERCHANT_PROFILES_KEY);
    if (!raw) return null;
    const profiles: Record<string, MerchantProfile> = JSON.parse(raw);
    return profiles[walletAddress.toLowerCase()] || null;
  } catch (e) {
    console.error('Failed to get merchant profile:', e);
    return null;
  }
}

export function saveMerchantProfile(profile: MerchantProfile): void {
  if (typeof window === 'undefined' || !profile.walletAddress) return;
  try {
    const raw = localStorage.getItem(MERCHANT_PROFILES_KEY);
    const profiles: Record<string, MerchantProfile> = raw ? JSON.parse(raw) : {};
    profiles[profile.walletAddress.toLowerCase()] = {
      ...profile,
      updatedAt: Date.now(),
    };
    localStorage.setItem(MERCHANT_PROFILES_KEY, JSON.stringify(profiles));
  } catch (e) {
    console.error('Failed to save merchant profile:', e);
  }
}

/**
 * Platform Admin Analytics
 */
export function getPlatformAnalytics(): PlatformAnalytics {
  const allReceipts = getCustomerReceipts();
  const allInvoices = getMerchantInvoices();

  const paidInvoices = allInvoices.filter((i) => i.status === 'paid');
  const completedReceipts = allReceipts.filter((r) => r.status === 'completed');

  const totalVolumeUsd = paidInvoices.reduce((acc, curr) => acc + (curr.fiatAmount || 0), 0);
  const totalPayfluxRevenueUsd = paidInvoices.length * PAYFLUX_PLATFORM_FEE_USD;

  const merchantAddresses = new Set(allInvoices.map((i) => i.merchantAddress.toLowerCase()));
  const customerAddresses = new Set(
    allReceipts.map((r) => (r.payerAddress ? r.payerAddress.toLowerCase() : ''))
  );
  customerAddresses.delete('');

  return {
    totalTransactions: allInvoices.length,
    totalVolumeUsd,
    totalPayfluxRevenueUsd,
    totalMerchantsCount: Math.max(merchantAddresses.size, 1),
    totalCustomersCount: Math.max(customerAddresses.size, completedReceipts.length > 0 ? 1 : 0),
    successfulCount: paidInvoices.length,
    failedCount: allInvoices.filter((i) => i.status === 'failed').length,
    recentActivity: allReceipts.slice(0, 10),
  };
}
