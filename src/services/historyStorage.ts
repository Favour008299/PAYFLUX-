import { TransactionRecord, TxType, TxStatus } from '../types';
import { db } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  Unsubscribe
} from 'firebase/firestore';
import { getAllSwapRecords } from './swapAnalyticsService';
import { getCustomerReceipts } from './paymentStorage';
import { PAYFLUX_PLATFORM_FEE_USD } from '../config/platform';

const HISTORY_STORAGE_KEY = 'payflux_transaction_history';
const DELETED_HISTORY_KEY = 'payflux_deleted_history_ids';

let realtimeHistoryUnsub: Unsubscribe | null = null;
let isHistoryTelemetryInitialized = false;

// Clean empty initial state - No fake or mock wallets are allowed
export const DEFAULT_INITIAL_TRANSACTIONS: TransactionRecord[] = [];

/**
 * Strips undefined properties for Firestore
 */
function sanitizeRecord<T extends Record<string, any>>(obj: T): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        clean[k] = sanitizeRecord(v);
      } else {
        clean[k] = v;
      }
    }
  }
  return clean;
}

/**
 * Get list of explicitly deleted transaction IDs to prevent re-importing
 */
function getDeletedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DELETED_HISTORY_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function addDeletedId(id: string) {
  if (typeof window === 'undefined' || !id) return;
  try {
    const ids = getDeletedIds();
    ids.add(id);
    localStorage.setItem(DELETED_HISTORY_KEY, JSON.stringify(Array.from(ids)));
  } catch (err) {
    console.error('Failed to save deleted ID:', err);
  }
}

/**
 * Dispatches window event for UI re-render
 */
export function emitHistoryUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('payflux_history_update'));
  }
}

/**
 * Syncs a single history record to Firestore
 */
export async function syncHistoryRecordToFirestore(record: TransactionRecord): Promise<void> {
  try {
    const docRef = doc(db, 'payflux_history', record.id);
    const clean = sanitizeRecord(record);
    await setDoc(docRef, clean, { merge: true });
  } catch (err) {
    console.warn('Firestore history sync notice:', err);
  }
}

/**
 * Deletes a single history record from Firestore
 */
export async function deleteHistoryRecordFromFirestore(id: string): Promise<void> {
  try {
    const docRef = doc(db, 'payflux_history', id);
    await deleteDoc(docRef);
  } catch (err) {
    console.warn('Firestore history delete notice:', err);
  }
}

/**
 * Real-time Firestore snapshot listener for history
 */
export function initRealtimeHistoryTelemetry(): () => void {
  if (typeof window === 'undefined' || realtimeHistoryUnsub) {
    return () => {};
  }

  try {
    const colRef = collection(db, 'payflux_history');
    realtimeHistoryUnsub = onSnapshot(
      colRef,
      (snap) => {
        if (!snap || snap.empty) return;
        const deletedIds = getDeletedIds();
        const remoteList: TransactionRecord[] = [];
        
        snap.forEach((d) => {
          const data = d.data() as TransactionRecord;
          if (data && data.id && !deletedIds.has(data.id)) {
            remoteList.push(data);
          }
        });

        if (remoteList.length > 0) {
          const local = getStoredTransactionsRaw();
          const map = new Map<string, TransactionRecord>();
          for (const item of local) {
            if (!deletedIds.has(item.id)) map.set(item.id, item);
          }
          for (const item of remoteList) {
            const existing = map.get(item.id);
            if (!existing || item.timestamp >= (existing.timestamp || 0)) {
              map.set(item.id, item);
            }
          }
          const merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
          try {
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(merged));
            emitHistoryUpdate();
          } catch (err) {
            console.error('Failed to update local history from Firestore snapshot:', err);
          }
        }
      },
      (err) => {
        console.warn('Realtime history snapshot notice:', err);
      }
    );
    isHistoryTelemetryInitialized = true;
  } catch (err) {
    console.warn('Could not initialize realtime history listener:', err);
  }

  return () => {
    if (realtimeHistoryUnsub) {
      realtimeHistoryUnsub();
      realtimeHistoryUnsub = null;
      isHistoryTelemetryInitialized = false;
    }
  };
}

/**
 * Subscribes to real-time history updates
 */
export function subscribeToHistory(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  if (!isHistoryTelemetryInitialized) {
    initRealtimeHistoryTelemetry();
  }

  const handler = () => {
    callback();
  };

  window.addEventListener('payflux_history_update', handler);
  window.addEventListener('storage', (e) => {
    if (e.key === HISTORY_STORAGE_KEY) {
      callback();
    }
  });

  return () => {
    window.removeEventListener('payflux_history_update', handler);
    window.removeEventListener('storage', handler);
  };
}

function getStoredTransactionsRaw(): TransactionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Retrieve all persistent transactions.
 * Merges direct history, completed swap records, and payment receipts so NOTHING is lost.
 */
export function getStoredTransactions(): TransactionRecord[] {
  if (typeof window === 'undefined') return DEFAULT_INITIAL_TRANSACTIONS;
  const deletedIds = getDeletedIds();

  // 1. Get direct history records
  let rawList = getStoredTransactionsRaw();

  // If first time initialization, seed with sample data
  const hasInitialized = localStorage.getItem('payflux_history_initialized');
  if (!hasInitialized && rawList.length === 0) {
    rawList = [...DEFAULT_INITIAL_TRANSACTIONS];
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(rawList));
      localStorage.setItem('payflux_history_initialized', 'true');
    } catch {}
  }

  const txMap = new Map<string, TransactionRecord>();

  // Add raw transactions that have not been deleted
  for (const tx of rawList) {
    if (tx && tx.id && !deletedIds.has(tx.id) && !deletedIds.has(tx.hash)) {
      txMap.set(tx.id, tx);
      if (tx.hash) txMap.set(tx.hash, tx);
    }
  }

  // 2. Merge all completed swaps from swapAnalyticsService
  try {
    const swapRecords = getAllSwapRecords();
    for (const s of swapRecords) {
      if (!s || deletedIds.has(s.id) || (s.txHash && deletedIds.has(s.txHash))) continue;

      const swapTxId = `swap_${s.id}`;
      if (!txMap.has(swapTxId) && (!s.txHash || !txMap.has(s.txHash))) {
        const txStatus: TxStatus = s.status === 'success' ? 'completed' : s.status === 'pending' ? 'pending' : 'failed';
        const converted: TransactionRecord = {
          id: swapTxId,
          hash: s.txHash || `pending_${s.id}`,
          type: 'swap',
          fromTokenSymbol: s.fromTokenSymbol,
          toTokenSymbol: s.toTokenSymbol,
          fromAmount: s.fromAmount,
          toAmount: s.toAmount,
          timestamp: s.timestamp || Date.now(),
          status: txStatus,
          networkFeeUsd: 0.005,
          payfluxFeeUsd: PAYFLUX_PLATFORM_FEE_USD,
          blockNumber: s.blockNumber || 0,
          explorerUrl: s.explorerUrl || (s.txHash ? `https://polygonscan.com/tx/${s.txHash}` : ''),
          network: s.network || 'polygon',
          orderId: s.orderId,
        };
        txMap.set(swapTxId, converted);
      }
    }
  } catch (err) {
    console.warn('Notice importing swap records into history:', err);
  }

  // 3. Merge all customer payment receipts from paymentStorage
  try {
    const receipts = getCustomerReceipts();
    for (const r of receipts) {
      if (!r || deletedIds.has(r.id) || (r.txHash && deletedIds.has(r.txHash))) continue;

      const paymentTxId = `pay_${r.id}`;
      if (!txMap.has(paymentTxId) && (!r.txHash || !txMap.has(r.txHash))) {
        const txStatus: TxStatus = r.status === 'completed' ? 'completed' : r.status === 'pending' ? 'pending' : 'failed';
        const converted: TransactionRecord = {
          id: paymentTxId,
          hash: r.txHash || `pending_${r.id}`,
          type: 'payment',
          tokenSymbol: r.tokenSymbol,
          amount: r.amountPaid,
          merchantName: r.merchantName,
          productName: r.productName,
          recipientAddress: r.merchantAddress,
          senderAddress: r.payerAddress,
          timestamp: r.timestamp || Date.now(),
          status: txStatus,
          networkFeeUsd: r.networkFeeUsd || 0.005,
          payfluxFeeUsd: r.payfluxFeeUsd || PAYFLUX_PLATFORM_FEE_USD,
          blockNumber: 0,
          explorerUrl: r.explorerUrl || (r.txHash ? `https://polygonscan.com/tx/${r.txHash}` : ''),
          network: r.network || 'polygon',
        };
        txMap.set(paymentTxId, converted);
      }
    }
  } catch (err) {
    console.warn('Notice importing payment receipts into history:', err);
  }

  // Deduplicate and return sorted array
  const uniqueList: TransactionRecord[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();

  for (const item of txMap.values()) {
    if (seenIds.has(item.id)) continue;
    if (item.hash && item.hash.startsWith('0x') && seenHashes.has(item.hash)) continue;

    seenIds.add(item.id);
    if (item.hash && item.hash.startsWith('0x')) seenHashes.add(item.hash);
    uniqueList.push(item);
  }

  return uniqueList.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Permanently save or update a transaction in history
 */
export function saveTransaction(tx: TransactionRecord): void {
  if (typeof window === 'undefined' || !tx || !tx.id) return;
  try {
    const list = getStoredTransactions();
    const filtered = list.filter((item) => item.id !== tx.id && (item.hash !== tx.hash || !tx.hash));
    filtered.unshift(tx);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(filtered));
    emitHistoryUpdate();
    syncHistoryRecordToFirestore(tx).catch(() => {});
  } catch (e) {
    console.error('Failed to save transaction to history:', e);
  }
}

/**
 * Permanently delete a transaction from history
 */
export function deleteTransaction(id: string, hash?: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    addDeletedId(id);
    if (hash && hash.startsWith('0x')) {
      addDeletedId(hash);
    }

    const list = getStoredTransactionsRaw();
    const updated = list.filter((item) => item.id !== id && (!hash || item.hash !== hash));
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    emitHistoryUpdate();
    deleteHistoryRecordFromFirestore(id).catch(() => {});
  } catch (e) {
    console.error('Failed to delete transaction from history:', e);
  }
}

/**
 * Permanently clear all transactions from history
 */
export function clearAllTransactions(): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getStoredTransactions();
    for (const tx of current) {
      if (tx.id) addDeletedId(tx.id);
      if (tx.hash) addDeletedId(tx.hash);
    }
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([]));
    emitHistoryUpdate();
  } catch (e) {
    console.error('Failed to clear transaction history:', e);
  }
}

// Auto-initialize real-time telemetry on module execution
if (typeof window !== 'undefined') {
  initRealtimeHistoryTelemetry();
}
