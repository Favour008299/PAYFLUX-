import {
  SwapTransactionRecord,
  SwapAnalyticsSummary,
  SwapPairStat,
  SwapExecutionStatus,
  NetworkType,
} from '../types';
import { PAYFLUX_PLATFORM_FEE_USD, PAYFLUX_TREASURY_ADDRESS } from '../config/platform';
import { db } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  Unsubscribe
} from 'firebase/firestore';

const SWAP_RECORDS_KEY = 'payflux_swap_analytics_records';

let realtimeFirestoreUnsub: Unsubscribe | null = null;
let isTelemetryInitialized = false;

/**
 * Sanitizes object by stripping undefined values and non-serializable properties
 * to prevent Firestore "Unsupported field value: undefined" runtime errors.
 */
function sanitizeForFirestore<T extends Record<string, any>>(obj: T): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        clean[key] = sanitizeForFirestore(value);
      } else {
        clean[key] = value;
      }
    }
  }
  return clean;
}

/**
 * Dispatches a client event when swap records change
 */
export function emitSwapAnalyticsUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('payflux_swap_analytics_update'));
  }
}

/**
 * Real-time Firestore snapshot listener for multi-user / multi-device swap telemetry
 */
export function initRealtimeSwapTelemetry(): () => void {
  if (typeof window === 'undefined' || realtimeFirestoreUnsub) {
    return () => {};
  }

  try {
    const colRef = collection(db, 'payflux_swaps');
    realtimeFirestoreUnsub = onSnapshot(
      colRef,
      (snap) => {
        if (!snap || snap.empty) return;
        const remoteList: SwapTransactionRecord[] = [];
        snap.forEach((d) => {
          const data = d.data() as SwapTransactionRecord;
          if (data && data.id) {
            remoteList.push(data);
          }
        });

        if (remoteList.length > 0) {
          const local = getAllSwapRecords();
          const mergedMap = new Map<string, SwapTransactionRecord>();
          for (const item of local) mergedMap.set(item.id, item);
          for (const item of remoteList) {
            const existing = mergedMap.get(item.id);
            const isTerminal = (s?: string) => s === 'confirmed' || s === 'success' || s === 'failed' || s === 'rejected' || s === 'cancelled';
            if (!existing || isTerminal(item.status) || !isTerminal(existing.status) || (item.updatedAt || item.timestamp || 0) >= (existing.updatedAt || existing.timestamp || 0)) {
              mergedMap.set(item.id, item);
            }
          }
          const merged = Array.from(mergedMap.values()).sort(
            (a, b) => (b.timestamp || b.updatedAt || 0) - (a.timestamp || a.updatedAt || 0)
          );
          try {
            localStorage.setItem(SWAP_RECORDS_KEY, JSON.stringify(merged));
            emitSwapAnalyticsUpdate();
          } catch (err) {
            console.error('Failed to update local swap records from Firestore snapshot:', err);
          }
        }
      },
      (err) => {
        console.warn('Realtime swap snapshot listener notice:', err);
      }
    );
    isTelemetryInitialized = true;
  } catch (err) {
    console.warn('Could not initialize realtime swap telemetry listener:', err);
  }

  return () => {
    if (realtimeFirestoreUnsub) {
      realtimeFirestoreUnsub();
      realtimeFirestoreUnsub = null;
      isTelemetryInitialized = false;
    }
  };
}

/**
 * Subscribes to real-time swap analytics events
 */
export function subscribeToSwapAnalytics(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  // Ensure real-time Firestore listener is active
  if (!isTelemetryInitialized) {
    initRealtimeSwapTelemetry();
  }

  const handler = () => {
    callback();
  };

  window.addEventListener('payflux_swap_analytics_update', handler);
  window.addEventListener('storage', (e) => {
    if (e.key === SWAP_RECORDS_KEY) {
      callback();
    }
  });

  return () => {
    window.removeEventListener('payflux_swap_analytics_update', handler);
    window.removeEventListener('storage', handler);
  };
}

/**
 * Retrieve all persistent swap records (locally cached + Firestore synced)
 */
export function getAllSwapRecords(): SwapTransactionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SWAP_RECORDS_KEY);
    if (!raw) return [];
    const parsed: SwapTransactionRecord[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Deduplicate by record ID and sort descending by timestamp
    const seen = new Set<string>();
    const unique: SwapTransactionRecord[] = [];
    for (const item of parsed) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        unique.push(item);
      }
    }
    return unique.sort((a, b) => (b.timestamp || b.updatedAt || 0) - (a.timestamp || a.updatedAt || 0));
  } catch (e) {
    console.error('Failed to load swap records from storage:', e);
    return [];
  }
}

/**
 * Internal helper to save swap records list locally and trigger event
 */
function saveSwapRecords(records: SwapTransactionRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SWAP_RECORDS_KEY, JSON.stringify(records));
    emitSwapAnalyticsUpdate();
  } catch (e) {
    console.error('Failed to save swap records to storage:', e);
  }
}

/**
 * Direct async helper to persist a swap record into Firestore database with sanitization
 */
export async function syncSwapRecordToFirestore(record: SwapTransactionRecord): Promise<void> {
  try {
    const swapDocRef = doc(db, 'payflux_swaps', record.id);
    const cleanPayload = sanitizeForFirestore(record);
    await setDoc(swapDocRef, cleanPayload, { merge: true });
  } catch (err) {
    console.warn('[SwapPersistence] Firestore sync warning for doc ' + record.id + ':', err);
  }
}

/**
 * Record a new swap attempt when execution is initiated by a user
 */
export function recordSwapAttempt(params: {
  id?: string;
  userAddress: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
  fromAmount: string;
  toAmount: string;
  fromAmountUsd: number;
  toAmountUsd: number;
  network: NetworkType;
  chainId: number;
  isCrossChain?: boolean;
  routingProtocol?: string;
  orderId?: string;
  txHash?: string;
  status?: SwapExecutionStatus;
  failureReason?: string;
}): string {
  const id = params.id || `swap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const fromSym = (params.fromTokenSymbol || 'UNKNOWN').toUpperCase();
  const toSym = (params.toTokenSymbol || 'UNKNOWN').toUpperCase();
  const pair = `${fromSym}/${toSym}`;
  const now = Date.now();

  const record: SwapTransactionRecord = {
    id,
    userAddress: (params.userAddress || '0x').toLowerCase(),
    fromTokenSymbol: fromSym,
    toTokenSymbol: toSym,
    fromTokenAddress: params.fromTokenAddress || undefined,
    toTokenAddress: params.toTokenAddress || undefined,
    fromAmount: params.fromAmount || '0',
    toAmount: params.toAmount || '0',
    fromAmountUsd: params.fromAmountUsd || 0,
    toAmountUsd: params.toAmountUsd || 0,
    pair,
    network: params.network || 'polygon',
    chainId: params.chainId || (params.network === 'ethereum' ? 1 : 137),
    status: params.status || 'attempted',
    timestamp: now,
    updatedAt: now,
    txHash: params.txHash || undefined,
    failureReason: params.failureReason || undefined,
    isCrossChain: Boolean(params.isCrossChain),
    routingProtocol: params.routingProtocol || undefined,
    orderId: params.orderId || undefined,
    payfluxFeeUsd: PAYFLUX_PLATFORM_FEE_USD,
    feeRecipient: PAYFLUX_TREASURY_ADDRESS,
    feeToken: fromSym,
    feeAmountToken: params.fromAmountUsd > 0 ? (PAYFLUX_PLATFORM_FEE_USD / (params.fromAmountUsd / parseFloat(params.fromAmount || '1'))).toFixed(6) : undefined,
    feeStatus: params.status === 'confirmed' || params.status === 'success' ? 'confirmed' : 'pending',
  };

  const existing = getAllSwapRecords().filter((r) => r.id !== id);
  existing.unshift(record);
  saveSwapRecords(existing);

  // Sync to Firestore database immediately
  syncSwapRecordToFirestore(record).catch(() => {});

  return id;
}

/**
 * Update transaction status to pending when wallet signs and broadcasts the swap
 */
export function updateSwapPending(
  id: string,
  details: {
    txHash: string;
    explorerUrl?: string;
    orderId?: string;
    feeDetails?: {
      feeTxHash?: string;
      feeVerified?: boolean;
      feeRecipient?: string;
      feeToken?: string;
      feeAmountToken?: string;
      payfluxFeeUsd?: number;
      feeStatus?: 'confirmed' | 'uncollected' | 'pending' | 'failed';
    };
  }
): void {
  const records = getAllSwapRecords();
  const index = records.findIndex((r) => r.id === id);

  if (index !== -1) {
    const existingRec = records[index];
    const updated: SwapTransactionRecord = {
      ...existingRec,
      status: 'pending',
      txHash: details.txHash || existingRec.txHash,
      explorerUrl: details.explorerUrl || existingRec.explorerUrl,
      orderId: details.orderId || existingRec.orderId,
      updatedAt: Date.now(),
      feeTxHash: details.feeDetails?.feeTxHash || existingRec.feeTxHash,
      feeStatus: details.feeDetails?.feeStatus || existingRec.feeStatus,
    };
    records[index] = updated;
    saveSwapRecords(records);
    syncSwapRecordToFirestore(updated).catch(() => {});
  }
}

/**
 * Update transaction hash when wallet broadcasts the transaction
 */
export function updateSwapTxHash(
  id: string,
  txHash: string,
  explorerUrl?: string
): void {
  const records = getAllSwapRecords();
  const index = records.findIndex((r) => r.id === id);

  if (index !== -1) {
    const updated: SwapTransactionRecord = {
      ...records[index],
      status: 'pending',
      txHash,
      explorerUrl: explorerUrl || records[index].explorerUrl,
      updatedAt: Date.now(),
    };
    records[index] = updated;
    saveSwapRecords(records);
    syncSwapRecordToFirestore(updated).catch(() => {});
  }
}

export interface SwapSuccessDetails {
  txHash: string;
  blockNumber?: number;
  explorerUrl: string;
  orderId?: string;
  feeDetails?: {
    feeTxHash?: string;
    feeBlockNumber?: number;
    feeVerified: boolean;
    feeRecipient?: string;
    feeToken?: string;
    feeAmountToken?: string;
    payfluxFeeUsd?: number;
    feeStatus?: 'confirmed' | 'uncollected' | 'pending' | 'failed';
  };
}

/**
 * Record blockchain confirmation for a successful swap
 * A swap is ONLY marked Confirmed/Successful after the blockchain confirms a successful transaction on-chain.
 * Platform fee is ONLY marked confirmed if on-chain fee transfer was genuinely verified.
 */
export function recordSwapSuccess(
  id: string,
  details: SwapSuccessDetails
): void {
  const records = getAllSwapRecords();
  const index = records.findIndex((r) => r.id === id);

  const isFeeConfirmed = Boolean(details.feeDetails?.feeVerified && details.feeDetails?.feeTxHash);
  const feeStatus = isFeeConfirmed ? 'confirmed' : 'uncollected';
  const payfluxFeeUsd = isFeeConfirmed ? (details.feeDetails?.payfluxFeeUsd ?? PAYFLUX_PLATFORM_FEE_USD) : 0;
  const feeTxHash = isFeeConfirmed ? details.feeDetails?.feeTxHash : undefined;
  const feeBlockNumber = isFeeConfirmed ? details.feeDetails?.feeBlockNumber : undefined;
  const feeConfirmedAt = isFeeConfirmed ? Date.now() : undefined;
  const feeRecipient = isFeeConfirmed ? (details.feeDetails?.feeRecipient || PAYFLUX_TREASURY_ADDRESS) : PAYFLUX_TREASURY_ADDRESS;
  const now = Date.now();

  if (index !== -1) {
    const existingRec = records[index];
    const updated: SwapTransactionRecord = {
      ...existingRec,
      status: 'confirmed',
      txHash: details.txHash || existingRec.txHash,
      blockNumber: details.blockNumber || existingRec.blockNumber,
      explorerUrl: details.explorerUrl || existingRec.explorerUrl,
      orderId: details.orderId || existingRec.orderId,
      failureReason: undefined,
      updatedAt: now,
      feeStatus,
      feeTxHash,
      feeBlockNumber,
      feeConfirmedAt,
      payfluxFeeUsd,
      feeRecipient,
      feeToken: details.feeDetails?.feeToken || existingRec.feeToken,
      feeAmountToken: details.feeDetails?.feeAmountToken || existingRec.feeAmountToken,
    };
    records[index] = updated;
    saveSwapRecords(records);
    syncSwapRecordToFirestore(updated).catch(() => {});
  } else {
    // If record was not in local cache, create confirmed record now
    const fallbackRecord: SwapTransactionRecord = {
      id,
      userAddress: '0x',
      fromTokenSymbol: 'UNKNOWN',
      toTokenSymbol: 'UNKNOWN',
      fromAmount: '0',
      toAmount: '0',
      fromAmountUsd: 0,
      toAmountUsd: 0,
      pair: 'UNKNOWN/UNKNOWN',
      network: 'polygon',
      chainId: 137,
      status: 'confirmed',
      txHash: details.txHash,
      blockNumber: details.blockNumber,
      explorerUrl: details.explorerUrl,
      orderId: details.orderId,
      timestamp: now,
      updatedAt: now,
      payfluxFeeUsd,
      feeRecipient,
      feeStatus,
      feeTxHash,
      feeBlockNumber,
      feeConfirmedAt,
    };
    records.unshift(fallbackRecord);
    saveSwapRecords(records);
    syncSwapRecordToFirestore(fallbackRecord).catch(() => {});
  }
}

/**
 * Record a failed, rejected, reverted, or cancelled swap transaction
 */
export function recordSwapFailure(
  id: string,
  failureReason: string,
  txHash?: string,
  specificStatus: 'failed' | 'rejected' | 'cancelled' = 'failed'
): void {
  const records = getAllSwapRecords();
  const index = records.findIndex((r) => r.id === id);
  const now = Date.now();

  if (index !== -1) {
    const updated: SwapTransactionRecord = {
      ...records[index],
      status: specificStatus,
      failureReason: failureReason || 'Transaction failed or rejected.',
      txHash: txHash || records[index].txHash,
      updatedAt: now,
      feeStatus: records[index].feeStatus === 'confirmed' ? 'confirmed' : 'failed',
    };
    records[index] = updated;
    saveSwapRecords(records);
    syncSwapRecordToFirestore(updated).catch(() => {});
  } else {
    // Fallback if not found
    const fallback: SwapTransactionRecord = {
      id,
      userAddress: '0x',
      fromTokenSymbol: 'UNKNOWN',
      toTokenSymbol: 'UNKNOWN',
      fromAmount: '0',
      toAmount: '0',
      fromAmountUsd: 0,
      toAmountUsd: 0,
      pair: 'UNKNOWN/UNKNOWN',
      network: 'polygon',
      chainId: 137,
      status: specificStatus,
      failureReason,
      txHash,
      timestamp: now,
      updatedAt: now,
      feeStatus: 'failed',
    };
    records.unshift(fallback);
    saveSwapRecords(records);
    syncSwapRecordToFirestore(fallback).catch(() => {});
  }
}

/**
 * Calculate full Swap Analytics Summary from authentic persistent database records.
 * Calculates: Total Attempts, Successful Swaps, Failed Swaps, Pending Swaps, Unique Swappers, Swap Volume, Swap Pairs, and Fees.
 */
export function getSwapAnalyticsSummary(): SwapAnalyticsSummary {
  const records = getAllSwapRecords();

  let successfulSwaps = 0;
  let failedSwaps = 0;
  let pendingSwaps = 0;
  let rejectedSwaps = 0;
  let cancelledSwaps = 0;
  let totalSwapVolumeUsd = 0;
  let totalSwapFeesUsd = 0;
  const uniqueUsers = new Set<string>();
  const pairMap = new Map<
    string,
    {
      fromTokenSymbol: string;
      toTokenSymbol: string;
      totalAttempts: number;
      successfulCount: number;
      failedCount: number;
      volumeUsd: number;
    }
  >();

  for (const rec of records) {
    if (rec.userAddress && rec.userAddress !== '0x' && rec.userAddress !== '') {
      uniqueUsers.add(rec.userAddress.toLowerCase());
    }

    const pairKey = rec.pair || `${rec.fromTokenSymbol || 'UNKNOWN'}/${rec.toTokenSymbol || 'UNKNOWN'}`;
    let pairStat = pairMap.get(pairKey);
    if (!pairStat) {
      pairStat = {
        fromTokenSymbol: rec.fromTokenSymbol || 'UNKNOWN',
        toTokenSymbol: rec.toTokenSymbol || 'UNKNOWN',
        totalAttempts: 0,
        successfulCount: 0,
        failedCount: 0,
        volumeUsd: 0,
      };
      pairMap.set(pairKey, pairStat);
    }

    pairStat.totalAttempts += 1;

    const isConfirmed = rec.status === 'confirmed' || rec.status === 'success';
    const isPending = rec.status === 'pending' || rec.status === 'attempted';
    const isRejected = rec.status === 'rejected';
    const isCancelled = rec.status === 'cancelled';
    const isFailed = rec.status === 'failed' || isRejected || isCancelled;

    if (isConfirmed) {
      successfulSwaps += 1;
      pairStat.successfulCount += 1;

      // Calculate USD volume with robust fallbacks
      let vol = 0;
      if (typeof rec.fromAmountUsd === 'number' && rec.fromAmountUsd > 0) {
        vol = rec.fromAmountUsd;
      } else if (typeof rec.toAmountUsd === 'number' && rec.toAmountUsd > 0) {
        vol = rec.toAmountUsd;
      } else {
        const numAmt = parseFloat(rec.fromAmount) || 0;
        if (numAmt > 0) {
          if (rec.fromTokenSymbol === 'POL') vol = numAmt * 0.25;
          else if (rec.fromTokenSymbol === 'ETH') vol = numAmt * 2400;
          else if (rec.fromTokenSymbol === 'VERSE') vol = numAmt * 0.00004;
          else if (rec.fromTokenSymbol === 'USDT' || rec.fromTokenSymbol === 'USDC' || rec.fromTokenSymbol === 'DAI') vol = numAmt * 1.0;
        }
      }

      totalSwapVolumeUsd += vol;
      pairStat.volumeUsd += vol;

      // Fee collection tally
      const fee = rec.payfluxFeeUsd !== undefined && rec.payfluxFeeUsd > 0 ? rec.payfluxFeeUsd : PAYFLUX_PLATFORM_FEE_USD;
      totalSwapFeesUsd += fee;
    } else if (isPending) {
      pendingSwaps += 1;
    } else if (isRejected) {
      rejectedSwaps += 1;
      failedSwaps += 1;
      pairStat.failedCount += 1;
    } else if (isCancelled) {
      cancelledSwaps += 1;
      failedSwaps += 1;
      pairStat.failedCount += 1;
    } else {
      // Failed
      failedSwaps += 1;
      pairStat.failedCount += 1;
    }
  }

  // Rank most used pairs by total attempts and volume
  const mostUsedPairs: SwapPairStat[] = Array.from(pairMap.entries())
    .map(([pair, stat]) => ({
      pair,
      fromTokenSymbol: stat.fromTokenSymbol,
      toTokenSymbol: stat.toTokenSymbol,
      totalAttempts: stat.totalAttempts,
      successfulCount: stat.successfulCount,
      failedCount: stat.failedCount,
      volumeUsd: stat.volumeUsd,
      successRate: stat.totalAttempts > 0 ? (stat.successfulCount / stat.totalAttempts) * 100 : 0,
    }))
    .sort((a, b) => b.totalAttempts - a.totalAttempts || b.volumeUsd - a.volumeUsd);

  return {
    totalAttempts: records.length,
    successfulSwaps,
    failedSwaps,
    pendingSwaps,
    rejectedSwaps,
    cancelledSwaps,
    uniqueUsersCount: uniqueUsers.size,
    totalSwapVolumeUsd,
    totalSwapFeesUsd,
    mostUsedPairs,
    recentSwaps: records,
  };
}

/**
 * Fetch swap records from Firestore to ensure synchronization for admins & multi-device ledger
 */
export async function syncSwapsFromFirestore(): Promise<SwapTransactionRecord[]> {
  try {
    const colRef = collection(db, 'payflux_swaps');
    const snap = await getDocs(colRef);

    if (snap && !snap.empty) {
      const remoteList: SwapTransactionRecord[] = [];
      snap.forEach((d) => {
        const data = d.data() as SwapTransactionRecord;
        if (data && data.id) {
          remoteList.push(data);
        }
      });

      if (remoteList.length > 0) {
        // Merge with local records preserving highest-fidelity data
        const local = getAllSwapRecords();
        const mergedMap = new Map<string, SwapTransactionRecord>();
        for (const item of local) mergedMap.set(item.id, item);
        
        const isTerminal = (s?: string) => s === 'confirmed' || s === 'success' || s === 'failed' || s === 'rejected' || s === 'cancelled';
        for (const item of remoteList) {
          const existing = mergedMap.get(item.id);
          if (!existing || isTerminal(item.status) || !isTerminal(existing.status) || (item.updatedAt || item.timestamp || 0) >= (existing.updatedAt || existing.timestamp || 0)) {
            mergedMap.set(item.id, item);
          }
        }
        const merged = Array.from(mergedMap.values()).sort(
          (a, b) => (b.timestamp || b.updatedAt || 0) - (a.timestamp || a.updatedAt || 0)
        );
        saveSwapRecords(merged);
        return merged;
      }
    }
  } catch (err) {
    console.warn('[SwapAnalytics] Error syncing swaps from Firestore:', err);
  }
  return getAllSwapRecords();
}

/**
 * Fetch directly from Firestore and compute the complete analytics summary
 */
export async function fetchLiveSwapAnalyticsSummary(): Promise<SwapAnalyticsSummary> {
  await syncSwapsFromFirestore();
  return getSwapAnalyticsSummary();
}

// Auto-initialize real-time telemetry on module execution
if (typeof window !== 'undefined') {
  initRealtimeSwapTelemetry();
}
