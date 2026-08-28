import {
  SwapTransactionRecord,
  SwapAnalyticsSummary,
  SwapPairStat,
  NetworkType,
} from '../types';
import { db } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  Unsubscribe
} from 'firebase/firestore';

const SWAP_RECORDS_KEY = 'payflux_swap_analytics_records';

let realtimeFirestoreUnsub: Unsubscribe | null = null;

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
            if (!existing || item.status === 'success' || item.status === 'failed' || item.timestamp >= (existing.timestamp || 0)) {
              mergedMap.set(item.id, item);
            }
          }
          const merged = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
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
  } catch (err) {
    console.warn('Could not initialize realtime swap telemetry listener:', err);
  }

  return () => {
    if (realtimeFirestoreUnsub) {
      realtimeFirestoreUnsub();
      realtimeFirestoreUnsub = null;
    }
  };
}

/**
 * Subscribes to real-time swap analytics events
 */
export function subscribeToSwapAnalytics(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  // Ensure real-time Firestore listener is active
  initRealtimeSwapTelemetry();

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
 * Retrieve all locally recorded swap records
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
    return unique.sort((a, b) => b.timestamp - a.timestamp);
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
 * Background async helper to persist a swap record into Firestore without blocking UI
 */
async function syncSwapRecordToFirestore(record: SwapTransactionRecord) {
  try {
    const swapDocRef = doc(db, 'payflux_swaps', record.id);
    const writePromise = setDoc(swapDocRef, record, { merge: true });
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Firestore write timeout')), 3500)
    );
    await Promise.race([writePromise, timeoutPromise]);
  } catch (err) {
    // Non-blocking background sync warning
    console.warn('Background swap Firestore sync warning:', err);
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
}): string {
  const id = params.id || `swap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const pair = `${params.fromTokenSymbol.toUpperCase()}/${params.toTokenSymbol.toUpperCase()}`;

  const record: SwapTransactionRecord = {
    id,
    userAddress: params.userAddress.toLowerCase(),
    fromTokenSymbol: params.fromTokenSymbol.toUpperCase(),
    toTokenSymbol: params.toTokenSymbol.toUpperCase(),
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount,
    toAmount: params.toAmount,
    fromAmountUsd: params.fromAmountUsd,
    toAmountUsd: params.toAmountUsd,
    pair,
    network: params.network,
    chainId: params.chainId,
    status: 'pending',
    timestamp: Date.now(),
    isCrossChain: params.isCrossChain,
    routingProtocol: params.routingProtocol,
    orderId: params.orderId,
  };

  const existing = getAllSwapRecords().filter((r) => r.id !== id);
  existing.unshift(record);
  saveSwapRecords(existing);

  // Sync to Firestore in background
  syncSwapRecordToFirestore(record).catch(() => {});

  return id;
}

/**
 * Record blockchain confirmation for a successful swap
 */
export function recordSwapSuccess(
  id: string,
  details: {
    txHash: string;
    blockNumber?: number;
    explorerUrl: string;
    orderId?: string;
  }
): void {
  const records = getAllSwapRecords();
  const index = records.findIndex((r) => r.id === id);

  if (index !== -1) {
    const updated: SwapTransactionRecord = {
      ...records[index],
      status: 'success',
      txHash: details.txHash,
      blockNumber: details.blockNumber,
      explorerUrl: details.explorerUrl,
      orderId: details.orderId || records[index].orderId,
      failureReason: undefined,
    };
    records[index] = updated;
    saveSwapRecords(records);
    syncSwapRecordToFirestore(updated).catch(() => {});
  } else {
    // If record wasn't registered prior, create successful record now
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
      status: 'success',
      txHash: details.txHash,
      blockNumber: details.blockNumber,
      explorerUrl: details.explorerUrl,
      orderId: details.orderId,
      timestamp: Date.now(),
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
  txHash?: string
): void {
  const records = getAllSwapRecords();
  const index = records.findIndex((r) => r.id === id);

  if (index !== -1) {
    const updated: SwapTransactionRecord = {
      ...records[index],
      status: 'failed',
      failureReason,
      txHash: txHash || records[index].txHash,
    };
    records[index] = updated;
    saveSwapRecords(records);
    syncSwapRecordToFirestore(updated).catch(() => {});
  }
}

/**
 * Calculate full Swap Analytics Summary from authentic transaction data
 */
export function getSwapAnalyticsSummary(): SwapAnalyticsSummary {
  const records = getAllSwapRecords();

  let successfulSwaps = 0;
  let failedSwaps = 0;
  let totalSwapVolumeUsd = 0;
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
    if (rec.userAddress && rec.userAddress !== '0x') {
      uniqueUsers.add(rec.userAddress.toLowerCase());
    }

    const pairKey = rec.pair || `${rec.fromTokenSymbol}/${rec.toTokenSymbol}`;
    let pairStat = pairMap.get(pairKey);
    if (!pairStat) {
      pairStat = {
        fromTokenSymbol: rec.fromTokenSymbol,
        toTokenSymbol: rec.toTokenSymbol,
        totalAttempts: 0,
        successfulCount: 0,
        failedCount: 0,
        volumeUsd: 0,
      };
      pairMap.set(pairKey, pairStat);
    }

    pairStat.totalAttempts += 1;

    if (rec.status === 'success') {
      successfulSwaps += 1;
      const vol = rec.fromAmountUsd > 0 ? rec.fromAmountUsd : rec.toAmountUsd > 0 ? rec.toAmountUsd : 0;
      totalSwapVolumeUsd += vol;
      pairStat.successfulCount += 1;
      pairStat.volumeUsd += vol;
    } else if (rec.status === 'failed') {
      failedSwaps += 1;
      pairStat.failedCount += 1;
    } else if (rec.status === 'pending') {
      // Pending attempts that haven't been resolved yet count towards total attempts
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
    uniqueUsersCount: uniqueUsers.size,
    totalSwapVolumeUsd,
    mostUsedPairs,
    recentSwaps: records,
  };
}

/**
 * Fetch swap records from Firestore to ensure multi-device synchronization for admins
 */
export async function syncSwapsFromFirestore(): Promise<SwapTransactionRecord[]> {
  try {
    const colRef = collection(db, 'payflux_swaps');
    let snap: any = null;

    try {
      const q = query(colRef, orderBy('timestamp', 'desc'), limit(150));
      const fetchPromise = getDocs(q);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
      snap = await Promise.race([fetchPromise, timeoutPromise]);
    } catch {
      // Fallback without orderBy constraint
      try {
        const fetchAllPromise = getDocs(colRef);
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
        snap = await Promise.race([fetchAllPromise, timeoutPromise]);
      } catch (e) {
        console.warn('Fallback Firestore swap fetch notice:', e);
      }
    }

    if (snap && 'forEach' in snap) {
      const remoteList: SwapTransactionRecord[] = [];
      snap.forEach((d: any) => {
        const data = d.data() as SwapTransactionRecord;
        if (data && data.id) {
          remoteList.push(data);
        }
      });

      if (remoteList.length > 0) {
        // Merge with local records
        const local = getAllSwapRecords();
        const mergedMap = new Map<string, SwapTransactionRecord>();
        for (const item of local) mergedMap.set(item.id, item);
        for (const item of remoteList) {
          const existing = mergedMap.get(item.id);
          if (!existing || item.status === 'success' || item.status === 'failed' || (item.timestamp || 0) >= (existing.timestamp || 0)) {
            mergedMap.set(item.id, item);
          }
        }
        const merged = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
        saveSwapRecords(merged);
        return merged;
      }
    }
  } catch (err) {
    console.warn('Sync swaps from Firestore notice:', err);
  }
  return getAllSwapRecords();
}
