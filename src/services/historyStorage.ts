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

export function isRealEVMHash(hash?: string): boolean {
  if (!hash || typeof hash !== 'string') return false;
  const clean = hash.trim().toLowerCase();
  // Valid EVM transaction hash: starts with 0x and is 66 chars (0x + 64 hex chars)
  if (clean.startsWith('0x') && clean.length === 66 && /^0x[0-9a-f]{64}$/.test(clean)) {
    return true;
  }
  // Valid cross-chain DLN order ID
  if (clean.startsWith('dln_') && clean.length >= 10 && !clean.includes('mock') && !clean.includes('undefined')) {
    return true;
  }
  return false;
}

export function isRecordForWallet(tx: TransactionRecord, walletAddress?: string): boolean {
  if (!walletAddress || !tx) return false;
  const target = walletAddress.trim().toLowerCase();
  const candidates = [
    tx.userAddress,
    tx.senderAddress,
    tx.payerAddress,
    tx.walletAddress,
    tx.recipientAddress,
  ];
  return candidates.some(
    (addr) => typeof addr === 'string' && addr.trim().toLowerCase() === target
  );
}

export function isGenuineTransaction(tx: TransactionRecord): boolean {
  if (!tx || !tx.id) return false;
  // Exclude mock, placeholder, or dummy IDs/hashes
  if (typeof tx.id === 'string' && (tx.id.includes('mock') || tx.id.includes('dummy') || tx.id.includes('sample'))) {
    return false;
  }
  // If completed, check for real hash or DLN order ID
  if (tx.status === 'completed' && !isRealEVMHash(tx.hash) && (!tx.hash || !tx.hash.startsWith('dln_'))) {
    return false;
  }
  // Must have an amount or token symbols
  const amtStr = tx.amount || tx.fromAmount || tx.toAmount;
  if (amtStr) {
    const num = parseFloat(amtStr);
    if (!isNaN(num) && num > 0) return true;
  }
  return tx.status === 'failed' || tx.status === 'pending';
}

function getStoredTransactionsRaw(): TransactionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Filter out any corrupt, mock, or fake pending placeholders
    const valid = parsed.filter((item) => {
      if (!item || !item.id) return false;
      return isGenuineTransaction(item);
    });

    if (valid.length !== parsed.length) {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * Retrieve all persistent real transactions for the connected wallet.
 * Merges direct history, confirmed/pending/failed swap records with real tx hashes, and payment receipts.
 * No fake, mock, or unassociated transactions are returned.
 */
export function getStoredTransactions(filterCustomerAddress?: string): TransactionRecord[] {
  if (typeof window === 'undefined') return [];
  
  // Strict connected wallet scoping: if no wallet is connected, return empty list
  if (!filterCustomerAddress || typeof filterCustomerAddress !== 'string' || !filterCustomerAddress.trim()) {
    return [];
  }

  const targetAddr = filterCustomerAddress.trim().toLowerCase();
  const deletedIds = getDeletedIds();

  // 1. Get direct valid history records
  const rawList = getStoredTransactionsRaw();
  const txMap = new Map<string, TransactionRecord>();

  // Add raw transactions that belong to this wallet, have not been deleted, and are genuine
  for (const tx of rawList) {
    if (!tx || !tx.id || deletedIds.has(tx.id) || (tx.hash && deletedIds.has(tx.hash))) continue;
    if (!isGenuineTransaction(tx)) continue;
    if (!isRecordForWallet(tx, targetAddr)) continue;

    txMap.set(tx.id, tx);
    if (tx.hash && isRealEVMHash(tx.hash)) {
      txMap.set(tx.hash.toLowerCase(), tx);
    }
  }

  // 2. Merge real swap records for this wallet from swapAnalyticsService
  try {
    const swapRecords = getAllSwapRecords();
    for (const s of swapRecords) {
      if (!s || deletedIds.has(s.id) || (s.txHash && deletedIds.has(s.txHash))) continue;
      // Strictly match wallet address
      if (!s.userAddress || s.userAddress.toLowerCase() !== targetAddr) continue;

      const hasRealHash = isRealEVMHash(s.txHash);
      const isFailedOrRejected = s.status === 'failed' || s.status === 'rejected' || s.status === 'cancelled';
      
      // Allow confirmed swaps, pending swaps with hash/orderId, and failed swaps
      if (!hasRealHash && !s.orderId && !isFailedOrRejected) continue;

      const isConfirmed = s.status === 'confirmed' || s.status === 'success';
      const txStatus: TxStatus = isConfirmed ? 'completed' : s.status === 'pending' ? 'pending' : 'failed';

      const swapTxId = `swap_${s.id}`;
      const hashKey = hasRealHash ? s.txHash!.toLowerCase() : null;
      const existingRecord = txMap.get(swapTxId) || (hashKey ? txMap.get(hashKey) : null);

      const converted: TransactionRecord = {
        id: existingRecord?.id || swapTxId,
        hash: s.txHash || (s.orderId ? `dln_${s.orderId}` : ''),
        type: 'swap',
        fromTokenSymbol: s.fromTokenSymbol,
        toTokenSymbol: s.toTokenSymbol,
        fromAmount: s.fromAmount,
        toAmount: s.toAmount,
        userAddress: s.userAddress,
        senderAddress: s.userAddress,
        walletAddress: s.userAddress,
        payerAddress: s.userAddress,
        timestamp: s.timestamp || s.updatedAt || Date.now(),
        status: txStatus,
        networkFeeUsd: 0.005,
        payfluxFeeUsd: s.feeStatus === 'confirmed' ? (s.payfluxFeeUsd ?? PAYFLUX_PLATFORM_FEE_USD) : 0,
        payfluxFeePol: s.feeStatus === 'confirmed' ? s.payfluxFeePol : 0,
        payfluxFeeDisplay: s.feeStatus === 'confirmed' ? s.payfluxFeeDisplay : (s.feeStatus === 'failed' ? '0 POL (Failed)' : '0.1 POL (Pending)'),
        feeStatus: s.feeStatus,
        feeTxHash: s.feeTxHash,
        blockNumber: s.blockNumber || 0,
        explorerUrl: s.explorerUrl || (hasRealHash ? `https://polygonscan.com/tx/${s.txHash}` : ''),
        network: s.network || 'polygon',
        orderId: s.orderId,
        failureReason: s.failureReason,
      };

      if (!existingRecord || (s.updatedAt && s.updatedAt >= (existingRecord.timestamp || 0)) || txStatus === 'completed') {
        txMap.set(converted.id, converted);
        if (hasRealHash) txMap.set(hashKey!, converted);
      }
    }
  } catch (err) {
    console.warn('Notice importing swap records into history:', err);
  }

  // 3. Merge real customer payment receipts for this wallet from paymentStorage
  try {
    const receipts = getCustomerReceipts();
    for (const r of receipts) {
      if (!r || deletedIds.has(r.id) || (r.txHash && deletedIds.has(r.txHash))) continue;
      
      // Match if user is payer or recipient
      const isUserPayer = r.payerAddress && r.payerAddress.toLowerCase() === targetAddr;
      const isUserRecipient = r.merchantAddress && r.merchantAddress.toLowerCase() === targetAddr;
      if (!isUserPayer && !isUserRecipient) continue;

      const hasRealHash = isRealEVMHash(r.txHash);
      if (!hasRealHash) continue;

      const paymentTxId = `pay_${r.id}`;
      const hashKey = r.txHash.toLowerCase();
      const existingRecord = txMap.get(paymentTxId) || txMap.get(hashKey);

      const txStatus: TxStatus = r.status === 'completed' ? 'completed' : r.status === 'pending' ? 'pending' : 'failed';
      const converted: TransactionRecord = {
        id: existingRecord?.id || paymentTxId,
        hash: r.txHash,
        type: 'payment',
        tokenSymbol: r.tokenSymbol,
        amount: r.amountPaid,
        merchantName: r.merchantName,
        productName: r.productName,
        recipientAddress: r.merchantAddress,
        senderAddress: r.payerAddress,
        userAddress: r.payerAddress,
        payerAddress: r.payerAddress,
        walletAddress: r.payerAddress,
        merchantReceivedAmount: r.merchantReceivedAmount,
        merchantReceivedAsset: r.merchantReceivedAsset,
        timestamp: r.timestamp || Date.now(),
        status: txStatus,
        networkFeeUsd: r.networkFeeUsd || 0.005,
        payfluxFeeUsd: r.feeStatus === 'confirmed' ? (r.payfluxFeeUsd ?? PAYFLUX_PLATFORM_FEE_USD) : 0,
        payfluxFeePol: r.feeStatus === 'confirmed' ? r.payfluxFeePol : 0,
        payfluxFeeDisplay: r.feeStatus === 'confirmed' ? (r.payfluxFeeDisplay || '0.1 POL') : (r.feeStatus === 'failed' ? '0 POL (Failed)' : '0.1 POL (Pending)'),
        feeStatus: r.feeStatus,
        feeTxHash: r.feeTxHash,
        blockNumber: r.blockNumber || 0,
        explorerUrl: r.explorerUrl || `https://polygonscan.com/tx/${r.txHash}`,
        network: r.network || 'polygon',
        failureReason: r.failureReason,
      };

      if (!existingRecord || (r.timestamp && r.timestamp >= (existingRecord.timestamp || 0)) || txStatus === 'completed') {
        txMap.set(converted.id, converted);
        txMap.set(hashKey, converted);
      }
    }
  } catch (err) {
    console.warn('Notice importing payment receipts into history:', err);
  }

  // Deduplicate and filter for real transactions only
  const uniqueList: TransactionRecord[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();

  for (const item of txMap.values()) {
    if (!item || !item.id) continue;
    if (seenIds.has(item.id)) continue;
    if (!isGenuineTransaction(item)) continue;
    if (!isRecordForWallet(item, targetAddr)) continue;

    if (item.hash && isRealEVMHash(item.hash)) {
      const lowerHash = item.hash.toLowerCase();
      if (seenHashes.has(lowerHash)) continue;
      seenHashes.add(lowerHash);
    }

    seenIds.add(item.id);
    uniqueList.push(item);
  }

  return uniqueList.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Permanently save or update a transaction in history
 * Never creates duplicate records; updates the matching record by ID or hash.
 */
export function saveTransaction(tx: TransactionRecord): void {
  if (typeof window === 'undefined' || !tx || !tx.id) return;
  // Strictly enforce real EVM transaction hash or valid DLN order for completed transactions
  if (tx.status === 'completed' && !isRealEVMHash(tx.hash) && (!tx.hash || !tx.hash.startsWith('dln_'))) {
    console.warn('[HistoryStorage] Rejected saving completed transaction without real EVM hash:', tx.hash);
    return;
  }
  // Ensure user/sender address is present
  if (!tx.userAddress && !tx.senderAddress && !tx.payerAddress && !tx.walletAddress) {
    console.warn('[HistoryStorage] Rejected saving transaction without associated wallet address');
    return;
  }
  try {
    const list = getStoredTransactionsRaw();
    const filtered = list.filter((item) => {
      if (item.id === tx.id) return false;
      if (tx.hash && isRealEVMHash(tx.hash) && item.hash && item.hash.toLowerCase() === tx.hash.toLowerCase()) {
        return false;
      }
      return true;
    });
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
