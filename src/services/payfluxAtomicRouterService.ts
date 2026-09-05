import {
  parseEther,
  formatEther,
  parseAbi,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import { PAYFLUX_TREASURY_ADDRESS, PAYFLUX_PLATFORM_FEE_POL, DEFAULT_PAYFLUX_ROUTER_ADDRESS } from '../config/platform';
import { safeGetAddress } from './addressUtils';
import { polygonRpcClient } from './evmRpcClients';
import { executeWalletTransaction } from './walletSigningService';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { PAYFLUX_ATOMIC_ROUTER_BYTECODE } from '../contracts/PayFluxAtomicRouterArtifact';

export { PAYFLUX_ATOMIC_ROUTER_BYTECODE };

function cleanRouterAddress(addr: any): string {
  if (typeof addr === 'string') {
    const trimmed = addr.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed) && trimmed !== '0x0000000000000000000000000000000000000000') {
      return safeGetAddress(trimmed);
    }
  }
  return '';
}

// Official ABI of the PayFlux Smart Contract & Atomic Router
export const PAYFLUX_ATOMIC_ROUTER_ABI = parseAbi([
  'constructor(address payable _treasury)',
  'function revenueWallet() external view returns (address)',
  'function treasury() external view returns (address payable)',
  'function nativeFee() external view returns (uint256)',
  'function PLATFORM_FEE_POL() external view returns (uint256)',
  'function owner() external view returns (address)',
  'function payNative(address merchant) external payable',
  'function payToken(address token, address merchant, uint256 amount, uint256 feeAmount) external',
  'function swapNativeWithFee(address payable targetRouter, bytes calldata swapData) external payable',
  'function swapTokenWithFee(address targetRouter, address tokenIn, uint256 amountIn, bytes calldata swapData) external payable',
  'function payNativeWithFee(address payable merchant, uint256 merchantAmount) external payable',
  'function payNativeWithFee(address payable merchant) external payable',
  'function payTokenWithFee(address token, address merchant, uint256 amount) external payable',
  'function withdrawNative() external',
  'function recoverToken(address token, uint256 amount) external',
  'event PaymentExecuted(address indexed payer, address indexed merchant, address indexed token, uint256 amount, uint256 feeAmount, uint256 timestamp)',
  'event FeeCollected(address indexed payer, address indexed recipient, uint256 feeAmount, uint256 timestamp)',
  'event AtomicSwapExecuted(address indexed user, address indexed tokenIn, uint256 amountIn, uint256 feePol, address targetRouter)',
  'event AtomicPaymentExecuted(address indexed payer, address indexed merchant, address indexed token, uint256 amount, uint256 feePol)',
  'receive() external payable',
]);

// Storage and Cache Keys
const ROUTER_STORAGE_KEY = 'payflux_atomic_router_address';
const FIRESTORE_CONFIG_COLL = 'payflux_config';
const FIRESTORE_ROUTER_DOC = 'atomic_router';

function resolveCandidateRouterAddress(): string {
  // 1. Check window global if injected
  if (typeof window !== 'undefined') {
    const winAddr = cleanRouterAddress((window as any).__PAYFLUX_ROUTER_ADDRESS__ || (window as any).PAYFLUX_ROUTER_ADDRESS);
    if (winAddr) return winAddr;
  }

  // 2. Check localStorage
  if (typeof window !== 'undefined') {
    const local = cleanRouterAddress(localStorage.getItem(ROUTER_STORAGE_KEY));
    if (local) return local;
  }

  // 3. Check environment variables
  const envAddr = cleanRouterAddress(
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PAYFLUX_ROUTER_ADDRESS) ||
    (typeof process !== 'undefined' && process.env?.VITE_PAYFLUX_ROUTER_ADDRESS)
  );
  if (envAddr) return envAddr;

  // 4. Default constant
  const def = cleanRouterAddress(DEFAULT_PAYFLUX_ROUTER_ADDRESS);
  if (def) return def;

  return '';
}

// In-memory active router address
let activeRouterAddress: string = resolveCandidateRouterAddress();

const listeners = new Set<(address: string) => void>();

/**
 * Checks if the PayFlux Atomic Router address is configured and valid
 */
export function isAtomicRouterConfigured(): boolean {
  const addr = getAtomicRouterAddress();
  return Boolean(addr && /^0x[a-fA-F0-9]{40}$/.test(addr.trim()) && addr.trim() !== '0x0000000000000000000000000000000000000000');
}

/**
 * Returns the currently active PayFlux Atomic Router address on Polygon PoS
 */
export function getAtomicRouterAddress(): string {
  if (activeRouterAddress && cleanRouterAddress(activeRouterAddress)) {
    return safeGetAddress(activeRouterAddress);
  }
  const resolved = resolveCandidateRouterAddress();
  if (resolved) {
    activeRouterAddress = resolved;
    return safeGetAddress(resolved);
  }
  return '';
}

/**
 * Updates the active atomic router address locally and across all active components
 */
export function setActiveRouterAddressLocal(address: string) {
  const clean = safeGetAddress(address);
  activeRouterAddress = clean;
  if (typeof window !== 'undefined') {
    if (clean) {
      localStorage.setItem(ROUTER_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(ROUTER_STORAGE_KEY);
    }
  }
  listeners.forEach((cb) => {
    try {
      cb(clean);
    } catch (e) {
      console.warn('[PayFlux Atomic Router] Listener error:', e);
    }
  });
}

/**
 * Saves and publishes the deployed atomic router address to Firestore so all users share it
 */
export async function saveAtomicRouterAddress(address: string, deployedBy?: string): Promise<void> {
  const clean = safeGetAddress(address);
  setActiveRouterAddressLocal(clean);

  try {
    const configRef = doc(db, FIRESTORE_CONFIG_COLL, FIRESTORE_ROUTER_DOC);
    await setDoc(
      configRef,
      {
        routerAddress: clean,
        network: 'polygon',
        chainId: 137,
        treasuryAddress: PAYFLUX_TREASURY_ADDRESS,
        deployedBy: deployedBy || 'admin',
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    console.log('[PayFlux Atomic Router] Published router address to Firestore:', clean);
  } catch (err) {
    console.warn('[PayFlux Atomic Router] Failed to persist router address to Firestore:', err);
  }
}

/**
 * Subscribes to updates to the Atomic Router address
 */
export function subscribeToAtomicRouterAddress(callback: (address: string) => void): () => void {
  listeners.add(callback);
  callback(getAtomicRouterAddress());
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Verifies if a contract address on Polygon PoS has valid bytecode and inspects its state
 */
export async function verifyRouterContractOnChain(address: string): Promise<{
  isValid: boolean;
  bytecodeLength?: number;
  treasury?: string;
  feePol?: string;
  errorMessage?: string;
}> {
  const clean = safeGetAddress(address);
  if (!clean || clean === '0x0000000000000000000000000000000000000000') {
    return { isValid: false, errorMessage: 'Invalid EVM contract address format.' };
  }

  try {
    const bytecode = await polygonRpcClient.getBytecode({ address: clean });
    if (!bytecode || bytecode === '0x' || bytecode.length < 100) {
      return { isValid: false, errorMessage: 'No smart contract bytecode deployed at this address on Polygon Mainnet.' };
    }

    let treasuryAddr = '';
    let feePolStr = '';
    try {
      const revResult = (await (polygonRpcClient as any).readContract({
        address: clean,
        abi: PAYFLUX_ATOMIC_ROUTER_ABI,
        functionName: 'revenueWallet',
      })) as string;
      treasuryAddr = safeGetAddress(revResult);
    } catch (e) {
      try {
        const treasuryResult = (await (polygonRpcClient as any).readContract({
          address: clean,
          abi: PAYFLUX_ATOMIC_ROUTER_ABI,
          functionName: 'treasury',
        })) as string;
        treasuryAddr = safeGetAddress(treasuryResult);
      } catch (e2) {
        console.warn('[PayFlux Atomic Router] revenueWallet/treasury read warning:', e2);
      }
    }

    try {
      const feeResult = (await (polygonRpcClient as any).readContract({
        address: clean,
        abi: PAYFLUX_ATOMIC_ROUTER_ABI,
        functionName: 'nativeFee',
      })) as bigint;
      feePolStr = formatEther(feeResult);
    } catch (e) {
      try {
        const feeResult = (await (polygonRpcClient as any).readContract({
          address: clean,
          abi: PAYFLUX_ATOMIC_ROUTER_ABI,
          functionName: 'PLATFORM_FEE_POL',
        })) as bigint;
        feePolStr = formatEther(feeResult);
      } catch (e2) {
        console.warn('[PayFlux Atomic Router] nativeFee/PLATFORM_FEE_POL read warning:', e2);
      }
    }

    return {
      isValid: true,
      bytecodeLength: bytecode.length,
      treasury: treasuryAddr || PAYFLUX_TREASURY_ADDRESS,
      feePol: feePolStr || '0.1',
    };
  } catch (err: any) {
    return { isValid: false, errorMessage: err?.message || 'Failed to query Polygon RPC.' };
  }
}

/**
 * Initializes real-time listener from Firestore to pick up newly deployed router address
 */
export function initAtomicRouterSync(): () => void {
  try {
    const configRef = doc(db, FIRESTORE_CONFIG_COLL, FIRESTORE_ROUTER_DOC);
    const unsub = onSnapshot(configRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data?.routerAddress) {
          const remoteAddr = safeGetAddress(data.routerAddress);
          if (remoteAddr && remoteAddr !== activeRouterAddress) {
            console.log('[PayFlux Atomic Router] Synced router address from Firestore:', remoteAddr);
            setActiveRouterAddressLocal(remoteAddr);
          }
        }
      }
    });
    return unsub;
  } catch (err) {
    console.warn('[PayFlux Atomic Router] Firestore sync notice:', err);
    return () => {};
  }
}

/**
 * Builds encoded calldata for atomic native POL swap or converted payment
 */
export function encodeAtomicSwapNative(params: {
  targetRouter: `0x${string}`;
  swapData: `0x${string}`;
}): `0x${string}` {
  return encodeFunctionData({
    abi: PAYFLUX_ATOMIC_ROUTER_ABI,
    functionName: 'swapNativeWithFee',
    args: [params.targetRouter, params.swapData],
  });
}

/**
 * Builds encoded calldata for atomic ERC-20 swap or converted payment
 */
export function encodeAtomicSwapToken(params: {
  targetRouter: `0x${string}`;
  tokenIn: `0x${string}`;
  amountIn: bigint;
  swapData: `0x${string}`;
}): `0x${string}` {
  return encodeFunctionData({
    abi: PAYFLUX_ATOMIC_ROUTER_ABI,
    functionName: 'swapTokenWithFee',
    args: [params.targetRouter, params.tokenIn, params.amountIn, params.swapData],
  });
}

/**
 * Checks if the configured contract supports atomic swap wrapping.
 * Contract 0x87a1F1E16683D72a1C2654c2267A7B3AF51f4599 on Polygon Mainnet is the dedicated
 * PayFlux Payment & Fee smart contract (payNative, payToken, fee collection).
 */
export function isSwapRoutingSupported(routerAddress?: string): boolean {
  const addr = (routerAddress || getAtomicRouterAddress()).toLowerCase();
  if (addr === '0x87a1f1e16683d72a1c2654c2267a7b3af51f4599') {
    return false;
  }
  return true;
}

/**
 * Builds encoded calldata for atomic direct native POL payment to merchant
 */
export function encodeAtomicPayNative(params: {
  merchant: `0x${string}`;
  merchantAmount?: bigint;
}): `0x${string}` {
  return encodeFunctionData({
    abi: PAYFLUX_ATOMIC_ROUTER_ABI,
    functionName: 'payNative',
    args: [params.merchant],
  });
}

/**
 * Builds encoded calldata for atomic direct ERC-20 payment to merchant
 */
export function encodeAtomicPayToken(params: {
  token: `0x${string}`;
  merchant: `0x${string}`;
  amount: bigint;
  feeAmount?: bigint;
}): `0x${string}` {
  const fee = params.feeAmount && params.feeAmount > 0n
    ? params.feeAmount
    : (params.amount >= 1000n ? params.amount / 100n : 1n);
  return encodeFunctionData({
    abi: PAYFLUX_ATOMIC_ROUTER_ABI,
    functionName: 'payToken',
    args: [params.token, params.merchant, params.amount, fee],
  });
}

/**
 * Encodes the deployment transaction bytecode with constructor parameters (_treasury)
 */
export function getAtomicRouterDeployBytecode(): `0x${string}` {
  const constructorArgs = encodeAbiParameters(
    parseAbiParameters('address payable _treasury'),
    [safeGetAddress(PAYFLUX_TREASURY_ADDRESS)]
  );
  // Remove leading '0x' from constructorArgs if present
  const cleanArgs = constructorArgs.startsWith('0x') ? constructorArgs.slice(2) : constructorArgs;
  return `${PAYFLUX_ATOMIC_ROUTER_BYTECODE}${cleanArgs}` as `0x${string}`;
}

/**
 * Deploys the PayFlux Atomic Router smart contract to Polygon PoS using the connected admin wallet
 */
export async function deployPayFluxAtomicRouter(params: {
  account: `0x${string}`;
  connector?: any;
  sendTransactionAsync?: any;
  walletName?: string;
}): Promise<{ txHash: string; contractAddress: string }> {
  const deployBytecode = getAtomicRouterDeployBytecode();

  console.log('[PayFlux Atomic Router] Initiating on-chain contract deployment on Polygon PoS...');
  const txHash = await executeWalletTransaction({
    account: params.account,
    to: undefined, // Contract deployment transaction has no 'to' recipient
    data: deployBytecode,
    value: 0n,
    chainId: 137,
    connector: params.connector,
    sendTransactionAsync: params.sendTransactionAsync,
    walletName: params.walletName,
    gas: '850000',
    timeoutMs: 90000,
    promptMobileWallet: true,
  });

  console.log('[PayFlux Atomic Router] Deployment transaction broadcasted:', txHash);
  const receipt = await polygonRpcClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    timeout: 60000,
  });

  if (receipt.status === 'reverted') {
    throw new Error(`Atomic Router deployment transaction reverted on-chain (Tx: ${txHash})`);
  }

  if (!receipt.contractAddress) {
    throw new Error(`Deployment confirmed on-chain but contract address was not returned (Tx: ${txHash})`);
  }

  const deployedAddress = safeGetAddress(receipt.contractAddress);
  console.log('[PayFlux Atomic Router] Contract successfully deployed at:', deployedAddress);

  // Persist to Firestore and local storage
  await saveAtomicRouterAddress(deployedAddress, params.account);

  return {
    txHash,
    contractAddress: deployedAddress,
  };
}

// Automatically sync on initial load
if (typeof window !== 'undefined') {
  initAtomicRouterSync();
}

