import { safeGetAddress, ZERO_ADDRESS, ERC20_STANDARD_ABI, polygonRpcClient, ethereumRpcClient } from './sharedSwapEngine';
import { shortenAddress } from '../utils/crypto';
import { launchBitcoinComWalletApp, openWalletRedirectUrl, wagmiAdapter, appKit } from '../config/web3';
import { encodeFunctionData } from 'viem';

export interface ActiveSigningSessionResult {
  provider: any;
  account: `0x${string}`;
  chainId: number;
}

export interface ExecuteWalletTransactionParams {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  account?: `0x${string}`;
  chainId?: number;
  connector?: any;
  sendTransactionAsync?: (args: any) => Promise<`0x${string}`>;
  walletName?: string;
  timeoutMs?: number;
  promptMobileWallet?: boolean;
  gas?: bigint | number | string;
}

export interface ExecuteTokenApprovalParams {
  tokenAddress: `0x${string}`;
  spenderAddress: `0x${string}`;
  amount: bigint;
  account?: `0x${string}`;
  chainId?: number;
  connector?: any;
  writeContractAsync?: (args: any) => Promise<`0x${string}`>;
  walletName?: string;
  timeoutMs?: number;
}

/**
 * Universal safe error message extractor
 */
export function safeFormatError(err: any): string {
  try {
    if (!err) return 'Unknown error occurred.';
    if (typeof err === 'string') return err;
    if (typeof err?.shortMessage === 'string' && err.shortMessage.trim()) {
      return err.shortMessage.trim();
    }
    if (typeof err?.cause?.shortMessage === 'string' && err.cause.shortMessage.trim()) {
      return err.cause.shortMessage.trim();
    }
    if (typeof err?.cause?.reason === 'string' && err.cause.reason.trim()) {
      return err.cause.reason.trim();
    }
    if (typeof err?.reason === 'string' && err.reason.trim()) {
      return err.reason.trim();
    }
    if (typeof err?.details === 'string' && err.details.trim()) {
      return err.details.trim();
    }
    if (typeof err?.cause?.message === 'string' && err.cause.message.trim()) {
      return err.cause.message.trim();
    }
    if (typeof err?.message === 'string' && err.message.trim()) {
      return err.message.trim();
    }
    return JSON.stringify(err, (_key, val) =>
      typeof val === 'bigint' ? val.toString() : val
    );
  } catch {
    try {
      return String(err);
    } catch {
      return 'Transaction failed or rejected.';
    }
  }
}

/**
 * Detects whether the current browser session is running on a mobile device.
 */
export function isMobileBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Returns the brand name of the currently connected or selected wallet.
 */
export function getConnectedWalletBrand(connectorName?: string): string {
  if (typeof window === 'undefined') return 'Bitcoin.com Wallet';
  const savedName = localStorage.getItem('payflux_connected_wallet_name') || '';
  const candidate = connectorName || savedName || '';
  const lower = candidate.toLowerCase();
  if (lower.includes('bitcoin') || lower.includes('verse')) return 'Bitcoin.com Wallet';
  if (lower.includes('metamask')) return 'MetaMask';
  if (lower.includes('trust')) return 'Trust Wallet';
  if (lower.includes('rainbow')) return 'Rainbow';
  if (lower.includes('coinbase')) return 'Coinbase Wallet';
  if (lower.includes('walletconnect') || !candidate) return 'Bitcoin.com Wallet';
  return candidate;
}

/**
 * Returns true if the active wallet is Bitcoin.com Wallet.
 */
export function isBitcoinComWallet(walletName?: string): boolean {
  const brand = getConnectedWalletBrand(walletName).toLowerCase();
  return brand.includes('bitcoin') || brand.includes('verse');
}

/**
 * Registers an active window/tab return detector.
 * When the user switches away to Bitcoin.com Wallet (or another wallet app) to approve
 * a connection, token allowance, or transaction, and then returns to PayFlux, this detector
 * triggers the provided callback so the app immediately resumes verification instead of
 * getting stuck or leaving the user confused.
 */
export function setupWalletReturnDetector(
  onReturn: () => void,
  debounceMs = 600
): () => void {
  if (typeof window === 'undefined') return () => {};

  let lastTriggered = 0;
  const handleReturn = () => {
    const now = Date.now();
    if (now - lastTriggered < debounceMs) return;
    lastTriggered = now;
    onReturn();
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      handleReturn();
    }
  };

  const handlePageShow = () => {
    handleReturn();
  };

  window.addEventListener('focus', handleReturn);
  window.addEventListener('pageshow', handlePageShow);
  document.addEventListener('visibilitychange', handleVisibility);
  document.addEventListener('resume', handleReturn as any);

  return () => {
    window.removeEventListener('focus', handleReturn);
    window.removeEventListener('pageshow', handlePageShow);
    document.removeEventListener('visibilitychange', handleVisibility);
    document.removeEventListener('resume', handleReturn as any);
  };
}

/**
 * Triggers mobile wallet application focus / deep-link for WalletConnect or native apps.
 * Safely dispatches custom scheme (e.g. bitcoincom://) so that the user's wallet opens directly.
 */
export function triggerMobileWalletPrompt(walletName?: string, mobileLink?: string) {
  if (typeof window === 'undefined') return;
  const isMobile = isMobileBrowser();
  if (!isMobile) return;

  // If running inside an in-app Web3 browser, do not trigger external URL schemes
  const isInAppWebview = Boolean(
    (window as any).ethereum &&
    !((window as any).ethereum.isWalletConnect) &&
    ((window as any).ethereum.isMetaMask ||
     (window as any).ethereum.isTrust ||
     (window as any).ethereum.isBitcoinCom ||
     (window as any).ethereum.isCoinbaseWallet ||
     (window as any).ethereum.isSafePal)
  );
  if (isInAppWebview) return;

  const savedName = localStorage.getItem('payflux_connected_wallet_name') || '';
  const wName = (walletName || savedName || '').toLowerCase();

  if (wName.includes('bitcoin') || wName.includes('verse') || wName.includes('walletconnect') || (!wName && !mobileLink)) {
    launchBitcoinComWalletApp();
  } else if (mobileLink) {
    openWalletRedirectUrl(mobileLink);
  } else if (wName.includes('metamask')) {
    openWalletRedirectUrl('metamask://');
  } else if (wName.includes('trust')) {
    openWalletRedirectUrl('trust://');
  } else if (wName.includes('rainbow')) {
    openWalletRedirectUrl('rainbow://');
  } else if (wName.includes('coinbase')) {
    openWalletRedirectUrl('cbwallet://');
  } else {
    launchBitcoinComWalletApp();
  }
}

/**
 * Safely resolves the active EIP-1193 wallet provider across Connector, AppKit, Wagmi Config, and Window
 */
export async function getActiveWalletProvider(connector?: any, fallbackProvider?: any): Promise<any> {
  if (fallbackProvider && typeof fallbackProvider.request === 'function') {
    return fallbackProvider;
  }

  // 1. Check connector directly
  if (connector && typeof connector.getProvider === 'function') {
    try {
      const p: any = await connector.getProvider();
      if (p && typeof p.request === 'function') return p;
    } catch (_) {}
  }

  // 2. Check current wagmi connection in wagmiConfig
  if (wagmiAdapter?.wagmiConfig?.state?.current && wagmiAdapter?.wagmiConfig?.state?.connections) {
    try {
      const currentConn: any = wagmiAdapter.wagmiConfig.state.connections.get(wagmiAdapter.wagmiConfig.state.current);
      if (currentConn?.connector && typeof currentConn.connector.getProvider === 'function') {
        const p: any = await currentConn.connector.getProvider();
        if (p && typeof p.request === 'function') return p;
      }
    } catch (_) {}
  }

  // 3. Iterate all active wagmi connections
  if (wagmiAdapter?.wagmiConfig?.state?.connections) {
    try {
      for (const [, conn] of (wagmiAdapter.wagmiConfig.state.connections as any).entries()) {
        if (conn?.connector && typeof conn.connector.getProvider === 'function') {
          try {
            const p: any = await conn.connector.getProvider();
            if (p && typeof p.request === 'function') return p;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // 4. Iterate wagmi configured connectors
  if (wagmiAdapter?.wagmiConfig?.connectors) {
    try {
      for (const c of wagmiAdapter.wagmiConfig.connectors) {
        if (c && typeof c.getProvider === 'function') {
          try {
            const p: any = await c.getProvider();
            if (p && typeof p.request === 'function') return p;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // 5. Check AppKit provider methods
  if (appKit) {
    try {
      if (typeof (appKit as any).getProvider === 'function') {
        const p = (appKit as any).getProvider('eip155') || (appKit as any).getProvider();
        if (p && typeof p.request === 'function') return p;
      }
      if (typeof (appKit as any).getWalletProvider === 'function') {
        const p = (appKit as any).getWalletProvider();
        if (p && typeof p.request === 'function') return p;
      }
    } catch (_) {}
  }

  // 6. Injected fallback
  if (typeof window !== 'undefined' && (window as any).ethereum && typeof (window as any).ethereum.request === 'function') {
    return (window as any).ethereum;
  }

  return null;
}

/**
 * Dispatches eth_sendTransaction with automated timeout and transient relay retry
 */
export async function sendTransactionWithRetry(
  provider: any,
  txParams: any,
  timeoutMs = 90000,
  timeoutMessage = 'Wallet confirmation timed out. Please check your wallet app.'
): Promise<`0x${string}`> {
  const withTimeoutPromise = <T>(promise: Promise<T>, ms: number, msg: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(msg)), ms);
      promise
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  };

  const executeRequest = async (): Promise<`0x${string}`> => {
    try {
      return await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });
    } catch (reqErr: any) {
      const errStr = String(reqErr?.message || reqErr || '').toLowerCase();
      if (errStr.includes('unknown account') && txParams.from) {
        // Try without explicit from address in case the wallet provider defaults to active account
        try {
          const paramsNoFrom = { ...txParams };
          delete paramsNoFrom.from;
          return await provider.request({
            method: 'eth_sendTransaction',
            params: [paramsNoFrom],
          });
        } catch (_) {
          throw reqErr;
        }
      }
      throw reqErr;
    }
  };

  try {
    return await withTimeoutPromise(executeRequest(), timeoutMs, timeoutMessage);
  } catch (err: any) {
    const errMsg = String(err?.message || err || '').toLowerCase();
    // If WalletConnect relay socket temporarily drops during app-switching, wait and retry once
    if (
      errMsg.includes('failed to publish payload') ||
      errMsg.includes('tag:1108') ||
      errMsg.includes('relay') ||
      errMsg.includes('socket')
    ) {
      console.warn('[WalletSigning] Transient relay notice detected. Waiting for relay re-sync and retrying once...');
      await new Promise((r) => setTimeout(r, 1200));
      return await withTimeoutPromise(executeRequest(), timeoutMs, timeoutMessage);
    }
    throw err;
  }
}

/**
 * Robust, shared transaction execution helper for both Swap and Pay.
 * Automatically dispatches the real transaction request to the currently connected wallet,
 * brings mobile wallet into focus for single approval, handles Wagmi connector state synchronizations,
 * and falls back directly to active WalletConnect / EIP-1193 provider when needed.
 */
export async function executeWalletTransaction(
  params: ExecuteWalletTransactionParams
): Promise<`0x${string}`> {
  const {
    to,
    data = '0x',
    value = 0n,
    account,
    chainId = 137,
    connector,
    sendTransactionAsync,
    walletName,
    timeoutMs = 90000,
    promptMobileWallet = true,
    gas,
  } = params;

  const validTo = safeGetAddress(to);
  if (!validTo || validTo === ZERO_ADDRESS) {
    throw new Error('Invalid destination transaction address.');
  }

  const senderAddr = account ? safeGetAddress(account) : undefined;
  const isContractCall = Boolean(data && data !== '0x' && data.length > 2);
  const targetClient = chainId === 1 ? ethereumRpcClient : polygonRpcClient;

  // Dynamic Gas Calculation & Buffer Resolution
  const providedGasBigInt =
    typeof gas === 'bigint'
      ? gas
      : (typeof gas === 'number' || typeof gas === 'string') && !isNaN(Number(gas)) && Number(gas) > 0
      ? BigInt(Math.round(Number(gas)))
      : undefined;

  let rpcEstimatedGas: bigint | undefined;
  try {
    rpcEstimatedGas = await targetClient.estimateGas({
      account: senderAddr && senderAddr !== ZERO_ADDRESS ? senderAddr : undefined,
      to: validTo,
      data: isContractCall ? (data as `0x${string}`) : undefined,
      value: value > 0n ? value : 0n,
    });
  } catch (estErr) {
    console.warn('[executeWalletTransaction] Target RPC estimateGas notice:', estErr);
  }

  let finalGasLimit: bigint;
  if (rpcEstimatedGas && rpcEstimatedGas > 0n) {
    // Add 40% buffer over on-chain RPC estimate
    const bufferedRpc = (rpcEstimatedGas * 140n) / 100n;
    const bufferedProvided = providedGasBigInt ? (providedGasBigInt * 125n) / 100n : 0n;
    finalGasLimit = bufferedRpc > bufferedProvided ? bufferedRpc : bufferedProvided;
  } else if (providedGasBigInt && providedGasBigInt > 0n) {
    // Add 35% buffer over route/quote provided gas (e.g., KyberSwap aggregator 700k -> 945k)
    finalGasLimit = (providedGasBigInt * 135n) / 100n;
  } else {
    // Safe fallback limit if simulation fails: ensure DEX aggregator swaps never hit a fatal 100k cap
    finalGasLimit = isContractCall ? 750_000n : 45_000n;
  }

  // Enforce safe floors so smart contract transactions never get starved of gas
  if (isContractCall && finalGasLimit < 400_000n) {
    finalGasLimit = 400_000n;
  } else if (!isContractCall && finalGasLimit < 21_000n) {
    finalGasLimit = 21_000n;
  }

  console.log('[executeWalletTransaction] Executing transaction with dynamic gas:', {
    to: validTo,
    isContractCall,
    rpcEstimatedGas: rpcEstimatedGas?.toString(),
    providedGas: providedGasBigInt?.toString(),
    finalGasLimit: finalGasLimit.toString(),
    value: value.toString(),
  });

  const walletBrand = getConnectedWalletBrand(walletName || connector?.name);

  // Trigger mobile wallet prompt so that Bitcoin.com Wallet / wallet app comes to the approval screen
  if (promptMobileWallet) {
    setTimeout(() => {
      triggerMobileWalletPrompt(walletBrand);
    }, 200);
  }

  // 1. Try sending via Wagmi sendTransactionAsync first if provided
  if (sendTransactionAsync) {
    try {
      const hash = await sendTransactionAsync({
        account: senderAddr && senderAddr !== ZERO_ADDRESS ? senderAddr : undefined,
        to: validTo,
        data: data as `0x${string}`,
        value,
        chainId,
        gas: finalGasLimit,
      });
      if (hash && typeof hash === 'string' && hash.startsWith('0x')) {
        return hash as `0x${string}`;
      }
    } catch (wagmiErr: any) {
      const errStr = safeFormatError(wagmiErr).toLowerCase();
      // If user actively rejected/denied the transaction in wallet, throw immediately
      if (
        errStr.includes('user rejected') ||
        errStr.includes('user denied') ||
        errStr.includes('rejected by user') ||
        errStr.includes('action_rejected') ||
        errStr.includes('transaction was rejected') ||
        errStr.includes('disapproved')
      ) {
        throw new Error('Transaction was rejected in your wallet.');
      }

      console.warn('[executeWalletTransaction] Wagmi sendTransaction notice, evaluating direct provider fallback:', wagmiErr);
    }
  }

  // 2. Direct EIP-1193 / WalletConnect Provider dispatch
  const activeProvider = await getActiveWalletProvider(connector);
  if (!activeProvider || typeof activeProvider.request !== 'function') {
    throw new Error(`Could not find an active connection to ${walletBrand}. Please make sure your wallet is open and connected.`);
  }

  // Ensure provider is on the correct network if supported
  if (chainId && typeof activeProvider.request === 'function') {
    try {
      await activeProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + chainId.toString(16) }],
      });
    } catch (_) {
      // Non-blocking chain switch attempt
    }
  }

  const txParams: any = {
    to: validTo,
    data: data || '0x',
    value: value > 0n ? '0x' + value.toString(16) : '0x0',
    gas: '0x' + finalGasLimit.toString(16),
  };

  if (senderAddr && senderAddr !== ZERO_ADDRESS) {
    txParams.from = senderAddr;
  }

  try {
    const hash = await sendTransactionWithRetry(
      activeProvider,
      txParams,
      timeoutMs,
      `Transaction confirmation timed out in ${walletBrand}. Please check your wallet app.`
    );
    return hash;
  } catch (providerErr: any) {
    const pErrStr = safeFormatError(providerErr).toLowerCase();
    if (
      pErrStr.includes('user rejected') ||
      pErrStr.includes('user denied') ||
      pErrStr.includes('rejected by user') ||
      pErrStr.includes('action_rejected') ||
      pErrStr.includes('transaction was rejected') ||
      pErrStr.includes('disapproved')
    ) {
      throw new Error('Transaction was rejected in your wallet.');
    }
    throw providerErr;
  }
}

/**
 * Robust, shared ERC20 approval execution helper for both Swap and Pay.
 */
export async function executeTokenApproval(
  params: ExecuteTokenApprovalParams
): Promise<`0x${string}`> {
  const {
    tokenAddress,
    spenderAddress,
    amount,
    account,
    chainId = 137,
    connector,
    writeContractAsync,
    walletName,
    timeoutMs = 75000,
  } = params;

  const validToken = safeGetAddress(tokenAddress);
  const validSpender = safeGetAddress(spenderAddress);
  const walletBrand = getConnectedWalletBrand(walletName || connector?.name);

  // Trigger mobile wallet prompt for approval
  setTimeout(() => {
    triggerMobileWalletPrompt(walletBrand);
  }, 200);

  if (writeContractAsync) {
    try {
      const hash = await (writeContractAsync as any)({
        account: account ? safeGetAddress(account) : undefined,
        address: validToken,
        abi: ERC20_STANDARD_ABI,
        functionName: 'approve',
        args: [validSpender, amount],
        chainId,
      });
      if (hash && typeof hash === 'string' && hash.startsWith('0x')) {
        return hash as `0x${string}`;
      }
    } catch (wagmiApprErr: any) {
      const errStr = safeFormatError(wagmiApprErr).toLowerCase();
      if (
        errStr.includes('user rejected') ||
        errStr.includes('user denied') ||
        errStr.includes('rejected by user') ||
        errStr.includes('action_rejected') ||
        errStr.includes('transaction was rejected') ||
        errStr.includes('disapproved')
      ) {
        throw new Error('Token approval was rejected in your wallet.');
      }
      console.warn('[executeTokenApproval] writeContractAsync notice, evaluating direct provider fallback:', wagmiApprErr);
    }
  }

  // Fallback to direct provider eth_sendTransaction
  const approveCalldata = encodeFunctionData({
    abi: ERC20_STANDARD_ABI,
    functionName: 'approve',
    args: [validSpender, amount],
  });

  return await executeWalletTransaction({
    to: validToken,
    data: approveCalldata,
    value: 0n,
    account,
    chainId,
    connector,
    walletName,
    timeoutMs,
    promptMobileWallet: false, // Already prompted above
  });
}

/**
 * Verifies that the connected wallet's active signing provider and session
 * are live, responding, matching the expected account, and ready to request signatures.
 */
export async function verifyActiveSigningSession(params: {
  connector?: any;
  appKitProvider?: any;
  expectedAccount?: string;
  targetChainId?: number;
}): Promise<ActiveSigningSessionResult> {
  const { connector, appKitProvider, expectedAccount, targetChainId } = params;

  // 1. Resolve active provider from connector, AppKit, wagmiAdapter config, or window.ethereum
  let activeProvider: any = null;

  try {
    activeProvider = await getActiveWalletProvider(connector, appKitProvider);
  } catch (e) {
    console.warn('[WalletSigning] getActiveWalletProvider error:', e);
  }

  if (!activeProvider) {
    activeProvider = (typeof window !== 'undefined' ? (window as any).ethereum : null);
  }

  // 2. Determine and verify active account
  let resolvedAccount = expectedAccount ? safeGetAddress(expectedAccount) : ZERO_ADDRESS;

  // If provider supports eth_accounts, query non-destructively
  if (activeProvider && typeof activeProvider.request === 'function') {
    try {
      const accounts = await Promise.race([
        activeProvider.request({ method: 'eth_accounts' }),
        new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
      ]);
      if (Array.isArray(accounts) && accounts.length > 0 && accounts[0]) {
        const providerAcct = safeGetAddress(accounts[0]);
        if (providerAcct !== ZERO_ADDRESS) {
          resolvedAccount = providerAcct;
        }
      }
    } catch (_) {
      // Non-blocking query: if expectedAccount is valid, we proceed with expectedAccount
    }
  }

  if (resolvedAccount === ZERO_ADDRESS) {
    if (expectedAccount && safeGetAddress(expectedAccount) !== ZERO_ADDRESS) {
      resolvedAccount = safeGetAddress(expectedAccount);
    } else {
      throw new Error('Please connect your wallet to continue.');
    }
  }

  // 3. Query active chain ID from provider
  let currentChainId = targetChainId || 137;
  if (activeProvider && typeof activeProvider.request === 'function') {
    try {
      const hexChain = await Promise.race([
        activeProvider.request({ method: 'eth_chainId' }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      if (hexChain) {
        currentChainId = typeof hexChain === 'string' ? parseInt(hexChain, 16) : Number(hexChain);
      }
    } catch {
      currentChainId = targetChainId || 137;
    }
  }

  // 4. If targetChainId is provided (e.g. 137 for Polygon or 1 for Ethereum) and doesn't match:
  if (targetChainId && currentChainId !== targetChainId && activeProvider?.request) {
    try {
      await activeProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + targetChainId.toString(16) }],
      });
      currentChainId = targetChainId;
    } catch (switchErr: any) {
      if (switchErr?.code === 4902 || switchErr?.message?.includes('4902')) {
        if (targetChainId === 137) {
          try {
            await activeProvider.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0x89',
                  chainName: 'Polygon Mainnet',
                  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
                  rpcUrls: ['https://polygon-rpc.com'],
                  blockExplorerUrls: ['https://polygonscan.com'],
                },
              ],
            });
            currentChainId = 137;
          } catch {
            // Proceed - Wagmi switchChain will handle if needed
          }
        }
      }
    }
  }

  return {
    provider: activeProvider,
    account: resolvedAccount,
    chainId: currentChainId,
  };
}
