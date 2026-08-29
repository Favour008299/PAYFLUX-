import { MerchantInvoice, CustomerPaymentReceipt, PlatformAnalytics } from '../types';
import { MerchantProfile, PAYFLUX_PLATFORM_FEE_USD } from '../config/platform';
import { getAllSwapRecords } from './swapAnalyticsService';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  Unsubscribe
} from 'firebase/firestore';
import { db } from '../config/firebase';

const INVOICES_KEY = 'payflux_merchant_invoices';
const CUSTOMER_RECEIPTS_KEY = 'payflux_customer_receipts';
const MERCHANT_PROFILES_KEY = 'payflux_merchant_profiles';

let realtimePaymentsUnsub: Unsubscribe | null = null;
let realtimeMerchantsUnsub: Unsubscribe | null = null;

export function emitMerchantProfileUpdate(walletAddress: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('payflux_merchant_profile_update', { detail: { walletAddress } }));
  }
}

export function subscribeToMerchantProfileUpdates(callback: (walletAddress: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  initRealtimeMerchantsRegistry();

  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ walletAddress: string }>;
    if (custom.detail?.walletAddress) {
      callback(custom.detail.walletAddress);
    }
  };

  window.addEventListener('payflux_merchant_profile_update', handler);
  window.addEventListener('storage', () => {
    callback('*');
  });

  return () => {
    window.removeEventListener('payflux_merchant_profile_update', handler);
  };
}

export function emitPaymentUpdate(invoiceId?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('payflux_payment_update', { detail: { invoiceId } }));
  }
}

export function subscribeToPaymentUpdates(callback: (invoiceId?: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  initRealtimePaymentsTelemetry();

  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ invoiceId?: string }>;
    callback(custom.detail?.invoiceId);
  };

  window.addEventListener('payflux_payment_update', handler);
  window.addEventListener('storage', () => {
    callback();
  });

  return () => {
    window.removeEventListener('payflux_payment_update', handler);
  };
}

/**
 * Real-time Firestore snapshot listener for multi-device payment telemetry
 */
export function initRealtimePaymentsTelemetry(): () => void {
  if (typeof window === 'undefined' || realtimePaymentsUnsub) {
    return () => {};
  }

  try {
    const colRef = collection(db, 'payflux_payments');
    realtimePaymentsUnsub = onSnapshot(
      colRef,
      (snap) => {
        if (!snap || snap.empty) return;
        const remoteList: CustomerPaymentReceipt[] = [];
        snap.forEach((d) => {
          const data = d.data() as CustomerPaymentReceipt;
          if (data && data.id) {
            remoteList.push(data);
          }
        });

        if (remoteList.length > 0) {
          const local = getCustomerReceipts();
          const mergedMap = new Map<string, CustomerPaymentReceipt>();
          for (const item of local) mergedMap.set(item.id, item);
          for (const item of remoteList) {
            const existing = mergedMap.get(item.id);
            if (!existing || item.status === 'completed' || item.status === 'failed' || item.timestamp >= (existing.timestamp || 0)) {
              mergedMap.set(item.id, item);
            }
          }
          const merged = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
          try {
            localStorage.setItem(CUSTOMER_RECEIPTS_KEY, JSON.stringify(merged));
            emitPaymentUpdate();
          } catch (err) {
            console.error('Failed to update local payment receipts from Firestore snapshot:', err);
          }
        }
      },
      (err) => {
        console.warn('Realtime payments snapshot notice:', err);
      }
    );
  } catch (err) {
    console.warn('Could not initialize realtime payments listener:', err);
  }

  return () => {
    if (realtimePaymentsUnsub) {
      realtimePaymentsUnsub();
      realtimePaymentsUnsub = null;
    }
  };
}

/**
 * Real-time listener for merchant profile registry
 */
export function initRealtimeMerchantsRegistry(): () => void {
  if (typeof window === 'undefined' || realtimeMerchantsUnsub) {
    return () => {};
  }

  try {
    const colRef = collection(db, 'payflux_merchants');
    realtimeMerchantsUnsub = onSnapshot(
      colRef,
      (snap) => {
        if (!snap || snap.empty) return;
        const raw = localStorage.getItem(MERCHANT_PROFILES_KEY);
        const profiles: Record<string, MerchantProfile> = raw ? JSON.parse(raw) : {};
        let updated = false;

        snap.forEach((d) => {
          const data = d.data() as MerchantProfile;
          if (data && data.walletAddress) {
            const key = data.walletAddress.toLowerCase();
            const existing = profiles[key];
            if (!existing || (data.updatedAt && data.updatedAt >= (existing.updatedAt || 0))) {
              profiles[key] = data;
              updated = true;
            }
          }
        });

        if (updated) {
          try {
            localStorage.setItem(MERCHANT_PROFILES_KEY, JSON.stringify(profiles));
            emitMerchantProfileUpdate('*');
          } catch (err) {
            console.error('Failed to update local merchant profiles cache:', err);
          }
        }
      },
      (err) => {
        console.warn('Realtime merchants snapshot notice:', err);
      }
    );
  } catch (err) {
    console.warn('Could not initialize realtime merchants listener:', err);
  }

  return () => {
    if (realtimeMerchantsUnsub) {
      realtimeMerchantsUnsub();
      realtimeMerchantsUnsub = null;
    }
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
 * Get customer payment receipts (scoped to customer address or all)
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
 * Asynchronously persist a payment record to Firestore
 */
async function syncPaymentToFirestore(receipt: CustomerPaymentReceipt): Promise<void> {
  try {
    const docRef = doc(db, 'payflux_payments', receipt.id);
    const writePromise = setDoc(docRef, receipt, { merge: true });
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Firestore payment write timeout')), 3500)
    );
    await Promise.race([writePromise, timeoutPromise]);
  } catch (err) {
    console.warn('Background Firestore payment sync warning:', err);
  }
}

/**
 * Save or record customer payment receipt
 */
export function saveCustomerReceipt(receipt: CustomerPaymentReceipt): void {
  if (typeof window === 'undefined') return;
  try {
    const enriched: CustomerPaymentReceipt = {
      ...receipt,
      payfluxFeeUsd: receipt.payfluxFeeUsd ?? PAYFLUX_PLATFORM_FEE_USD,
    };
    const existing = getCustomerReceipts().filter((r) => r.id !== receipt.id);
    existing.unshift(enriched);
    localStorage.setItem(CUSTOMER_RECEIPTS_KEY, JSON.stringify(existing));
    emitPaymentUpdate(receipt.invoiceId);
    syncPaymentToFirestore(enriched).catch(() => {});
  } catch (e) {
    console.error('Failed to save customer receipt:', e);
  }
}

/**
 * Record a payment attempt (before on-chain submission or confirmation)
 */
export function recordPaymentAttempt(params: {
  id?: string;
  invoiceId?: string;
  merchantName: string;
  merchantAddress: string;
  productName: string;
  payerAddress: string;
  amountPaid: string;
  tokenSymbol: string;
  fiatValueUsd: number;
  fiatAmount?: number;
  fiatCurrency?: string;
  network: any;
  chainId: number;
  txHash?: string;
  explorerUrl?: string;
}): string {
  const id = params.id || `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const record: CustomerPaymentReceipt = {
    id,
    invoiceId: params.invoiceId,
    merchantName: params.merchantName,
    merchantAddress: params.merchantAddress,
    productName: params.productName,
    payerAddress: params.payerAddress,
    amountPaid: params.amountPaid,
    tokenSymbol: params.tokenSymbol,
    fiatValueUsd: params.fiatValueUsd,
    fiatAmount: params.fiatAmount,
    fiatCurrency: params.fiatCurrency,
    payfluxFeeUsd: PAYFLUX_PLATFORM_FEE_USD,
    txHash: params.txHash || '',
    network: params.network,
    chainId: params.chainId,
    timestamp: Date.now(),
    status: 'pending',
    networkFeeUsd: 0.005,
    explorerUrl: params.explorerUrl || '',
  };

  saveCustomerReceipt(record);
  return id;
}

/**
 * Record a confirmed payment success
 */
export function recordPaymentSuccess(
  id: string,
  details: {
    txHash: string;
    explorerUrl: string;
    blockNumber?: number;
  }
): CustomerPaymentReceipt | null {
  const receipts = getCustomerReceipts();
  const index = receipts.findIndex((r) => r.id === id);

  if (index !== -1) {
    const updated: CustomerPaymentReceipt = {
      ...receipts[index],
      status: 'completed',
      txHash: details.txHash,
      explorerUrl: details.explorerUrl,
    };
    receipts[index] = updated;
    localStorage.setItem(CUSTOMER_RECEIPTS_KEY, JSON.stringify(receipts));
    emitPaymentUpdate(updated.invoiceId);
    syncPaymentToFirestore(updated).catch(() => {});
    return updated;
  }
  return null;
}

/**
 * Record a failed payment attempt
 */
export function recordPaymentFailure(
  id: string,
  failureReason: string,
  txHash?: string
): CustomerPaymentReceipt | null {
  const receipts = getCustomerReceipts();
  const index = receipts.findIndex((r) => r.id === id);

  if (index !== -1) {
    const updated: CustomerPaymentReceipt = {
      ...receipts[index],
      status: 'failed',
      txHash: txHash || receipts[index].txHash,
    };
    receipts[index] = updated;
    localStorage.setItem(CUSTOMER_RECEIPTS_KEY, JSON.stringify(receipts));
    emitPaymentUpdate(updated.invoiceId);
    syncPaymentToFirestore(updated).catch(() => {});
    return updated;
  }
  return null;
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

/**
 * Asynchronously fetch merchant profile from Firestore with localStorage caching
 */
export async function fetchMerchantProfile(walletAddress: string): Promise<MerchantProfile | null> {
  if (!walletAddress) return null;
  const normalizedAddr = walletAddress.toLowerCase();
  
  // 1. Check local cache first
  const localProfile = getMerchantProfile(normalizedAddr);

  // 2. Fetch latest profile from Firestore cloud registry
  try {
    const docRef = doc(db, 'payflux_merchants', normalizedAddr);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as MerchantProfile;
      if (data && data.merchantName) {
        // Save to local cache if newer or if local didn't exist
        if (!localProfile || (data.updatedAt && (!localProfile.updatedAt || data.updatedAt >= localProfile.updatedAt))) {
          saveMerchantProfile(data, false); // Don't re-upload to Firestore
          return data;
        }
      }
    }
  } catch (err) {
    console.warn('Could not fetch merchant profile from Firestore:', err);
  }

  return localProfile;
}

export function saveMerchantProfile(profile: MerchantProfile, syncToFirestore: boolean = true): void {
  if (typeof window === 'undefined' || !profile.walletAddress) return;
  const normalizedAddr = profile.walletAddress.toLowerCase();
  const enrichedProfile: MerchantProfile = {
    ...profile,
    walletAddress: profile.walletAddress,
    updatedAt: profile.updatedAt || Date.now(),
  };

  try {
    const raw = localStorage.getItem(MERCHANT_PROFILES_KEY);
    const profiles: Record<string, MerchantProfile> = raw ? JSON.parse(raw) : {};
    profiles[normalizedAddr] = enrichedProfile;
    localStorage.setItem(MERCHANT_PROFILES_KEY, JSON.stringify(profiles));
    emitMerchantProfileUpdate(normalizedAddr);
  } catch (e) {
    console.error('Failed to save merchant profile locally:', e);
  }

  // Synchronize to Firestore in the background
  if (syncToFirestore) {
    try {
      const docRef = doc(db, 'payflux_merchants', normalizedAddr);
      setDoc(docRef, enrichedProfile, { merge: true }).catch((err) => {
        console.warn('Firestore merchant profile sync notice:', err);
      });
    } catch (e) {
      console.warn('Failed to initiate Firestore merchant profile save:', e);
    }
  }
}

/**
 * Fetch and sync all payments from Firestore into local cache
 */
export async function syncPaymentsFromFirestore(): Promise<CustomerPaymentReceipt[]> {
  try {
    const colRef = collection(db, 'payflux_payments');
    let snap: any = null;

    try {
      const q = query(colRef, orderBy('timestamp', 'desc'), limit(150));
      const fetchPromise = getDocs(q);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
      snap = await Promise.race([fetchPromise, timeoutPromise]);
    } catch {
      try {
        const fetchAllPromise = getDocs(colRef);
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
        snap = await Promise.race([fetchAllPromise, timeoutPromise]);
      } catch (e) {
        console.warn('Fallback Firestore payments fetch notice:', e);
      }
    }

    if (snap && 'forEach' in snap) {
      const remoteList: CustomerPaymentReceipt[] = [];
      snap.forEach((d: any) => {
        const data = d.data() as CustomerPaymentReceipt;
        if (data && data.id) {
          remoteList.push(data);
        }
      });

      if (remoteList.length > 0) {
        const local = getCustomerReceipts();
        const mergedMap = new Map<string, CustomerPaymentReceipt>();
        for (const item of local) mergedMap.set(item.id, item);
        for (const item of remoteList) {
          const existing = mergedMap.get(item.id);
          if (!existing || item.status === 'completed' || item.status === 'failed' || (item.timestamp || 0) >= (existing.timestamp || 0)) {
            mergedMap.set(item.id, item);
          }
        }
        const merged = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
        try {
          localStorage.setItem(CUSTOMER_RECEIPTS_KEY, JSON.stringify(merged));
          emitPaymentUpdate();
          return merged;
        } catch (err) {
          console.error('Failed to save merged payments to localStorage:', err);
        }
      }
    }
  } catch (err) {
    console.warn('Sync payments from Firestore notice:', err);
  }
  return getCustomerReceipts();
}

/**
 * Platform Admin Analytics calculated from persistent database records
 */
export function getPlatformAnalytics(): PlatformAnalytics {
  const allReceipts = getCustomerReceipts();
  const allInvoices = getMerchantInvoices();
  const allSwaps = getAllSwapRecords();

  const completedReceipts = allReceipts.filter((r) => r.status === 'completed');
  const failedReceipts = allReceipts.filter((r) => r.status === 'failed');

  const successfulSwaps = allSwaps.filter((s) => s.status === 'confirmed' || s.status === 'success');
  const failedSwaps = allSwaps.filter((s) => s.status === 'failed' || s.status === 'rejected' || s.status === 'cancelled');

  // Calculate volume strictly from completed real blockchain payments + swaps
  const paymentVolumeUsd = completedReceipts.reduce((acc, curr) => {
    return acc + (curr.fiatValueUsd || 0);
  }, 0);

  const swapVolumeUsd = successfulSwaps.reduce((acc, curr) => {
    let vol = 0;
    if (typeof curr.fromAmountUsd === 'number' && curr.fromAmountUsd > 0) {
      vol = curr.fromAmountUsd;
    } else if (typeof curr.toAmountUsd === 'number' && curr.toAmountUsd > 0) {
      vol = curr.toAmountUsd;
    } else {
      const numAmt = parseFloat(curr.fromAmount) || 0;
      if (numAmt > 0) {
        if (curr.fromTokenSymbol === 'POL') vol = numAmt * 0.25;
        else if (curr.fromTokenSymbol === 'ETH') vol = numAmt * 2400;
        else if (curr.fromTokenSymbol === 'VERSE') vol = numAmt * 0.00004;
        else if (curr.fromTokenSymbol === 'USDT' || curr.fromTokenSymbol === 'USDC' || curr.fromTokenSymbol === 'DAI') vol = numAmt * 1.0;
      }
    }
    return acc + vol;
  }, 0);

  const totalVolumeUsd = paymentVolumeUsd + swapVolumeUsd;

  // Calculate revenue strictly from verified on-chain fee collections to revenue wallet (0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD)
  const confirmedFeeReceipts = completedReceipts.filter((r) => r.feeStatus === 'confirmed' && r.feeTxHash);
  const paymentRevenueUsd = confirmedFeeReceipts.reduce((acc, r) => acc + (r.payfluxFeeUsd || PAYFLUX_PLATFORM_FEE_USD), 0);

  const confirmedFeeSwaps = successfulSwaps.filter((s) => s.feeStatus === 'confirmed' || Boolean(s.feeTxHash));
  const swapRevenueUsd = confirmedFeeSwaps.reduce((acc, s) => acc + (s.payfluxFeeUsd || PAYFLUX_PLATFORM_FEE_USD), 0);
  const totalPayfluxRevenueUsd = paymentRevenueUsd + swapRevenueUsd;

  // Merchant addresses from receipts, invoices, and profiles
  const rawProfiles = typeof window !== 'undefined' ? localStorage.getItem(MERCHANT_PROFILES_KEY) : null;
  const profilesMap: Record<string, MerchantProfile> = rawProfiles ? JSON.parse(rawProfiles) : {};
  
  const merchantAddresses = new Set<string>();
  Object.keys(profilesMap).forEach((k) => merchantAddresses.add(k.toLowerCase()));
  allInvoices.forEach((i) => {
    if (i.merchantAddress) merchantAddresses.add(i.merchantAddress.toLowerCase());
  });
  completedReceipts.forEach((r) => {
    if (r.merchantAddress) merchantAddresses.add(r.merchantAddress.toLowerCase());
  });

  const customerAddresses = new Set<string>();
  allReceipts.forEach((r) => {
    if (r.payerAddress && r.payerAddress.startsWith('0x')) {
      customerAddresses.add(r.payerAddress.toLowerCase());
    }
  });
  allSwaps.forEach((s) => {
    if (s.userAddress && s.userAddress.startsWith('0x')) {
      customerAddresses.add(s.userAddress.toLowerCase());
    }
  });

  return {
    totalTransactions: allReceipts.length + allSwaps.length,
    totalVolumeUsd,
    totalPayfluxRevenueUsd,
    paymentRevenueUsd,
    swapRevenueUsd,
    totalMerchantsCount: Math.max(merchantAddresses.size, 0),
    totalCustomersCount: Math.max(customerAddresses.size, 0),
    successfulCount: completedReceipts.length + successfulSwaps.length,
    failedCount: failedReceipts.length + failedSwaps.length,
    totalSwapsCount: allSwaps.length,
    recentActivity: allReceipts.slice(0, 15),
  };
}

