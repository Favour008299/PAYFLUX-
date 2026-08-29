import React, { useEffect, useState, useRef } from 'react';
import {
  Loader2,
  Zap,
  ExternalLink,
  XCircle,
  CheckCircle2,
  RefreshCw,
  Globe,
  AlertTriangle,
  X,
  Smartphone
} from 'lucide-react';
import { SwapQuote, TransactionRecord } from '../types';
import { useAccount, useSwitchChain, useSendTransaction, useWriteContract, usePublicClient, useChainId } from 'wagmi';
import { useAppKit } from '../hooks/useAppKit';
import { parseUnits, encodeFunctionData } from 'viem';
import {
  safeGetAddress,
  isNativeAddress,
  ERC20_STANDARD_ABI,
  getUnifiedSwapQuote,
  ZERO_ADDRESS,
  polygonRpcClient,
  ethereumRpcClient,
} from '../services/sharedSwapEngine';
import { checkDeBridgeOrderStatus } from '../services/deBridgeService';
import {
  verifyActiveSigningSession,
  triggerMobileWalletPrompt,
  sendTransactionWithRetry,
  ActiveSigningSessionResult,
} from '../services/walletSigningService';
import {
  recordSwapAttempt,
  recordSwapSuccess,
  recordSwapFailure,
  updateSwapTxHash,
} from '../services/swapAnalyticsService';
import { executeAndVerifyPlatformFee, FeeExecutionResult } from '../services/payfluxFeeService';
import { PAYFLUX_TREASURY_ADDRESS } from '../config/platform';

interface SwapProcessingModalProps {
  isOpen: boolean;
  quote: SwapQuote | null;
  onComplete: (txRecord: Partial<TransactionRecord>) => void;
  onClose: () => void;
}

/**
 * Bulletproof error message extractor that safely converts any BigInts, nested objects,
 * or RPC error structures into human-readable strings without throwing serialization errors.
 */
function safeFormatError(err: any): string {
  try {
    if (!err) return 'Unknown error occurred.';
    if (typeof err === 'string') return err;
    if (typeof err?.shortMessage === 'string' && err.shortMessage.trim()) {
      return err.shortMessage.trim();
    }
    if (typeof err?.details === 'string' && err.details.trim()) {
      return err.details.trim();
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

export const SwapProcessingModal: React.FC<SwapProcessingModalProps> = ({
  isOpen,
  quote,
  onComplete,
  onClose,
}) => {
  const { open } = useAppKit();
  const { address: wagmiAddress, isConnected: wagmiConnected, connector } = useAccount();
  const wagmiChainId = useChainId();
  const publicClient = usePublicClient();

  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const activeAddress = wagmiAddress;
  const isWalletConnected = Boolean(wagmiConnected && activeAddress);
  const activeChainId = wagmiChainId;

  const [statusStep, setStatusStep] = useState<
    'validating' | 'network' | 'approval' | 'signing' | 'mining' | 'crosschain' | 'success' | 'error'
  >('validating');
  const [statusMessage, setStatusMessage] = useState<string>('Validating liquidity route...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [deBridgeOrderId, setDeBridgeOrderId] = useState<string | null>(null);
  const isExecutingRef = useRef(false);
  const hasCompletedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const txSentRef = useRef(false);
  const currentAttemptIdRef = useRef<string | null>(null);

  const executeRealSwap = async () => {
    if (!quote) return;

    // Track real on-chain swap attempt
    const fromToken = quote.fromToken;
    const toToken = quote.toToken;
    const fromAmountUsd = (parseFloat(quote.fromAmount) || 0) * (fromToken?.priceUsd || 0);
    const toAmountUsd = (parseFloat(quote.toAmount) || 0) * (toToken?.priceUsd || 0);
    const targetChainId: number = fromToken?.network === 'ethereum' ? 1 : 137;

    const attemptId = recordSwapAttempt({
      userAddress: activeAddress || '0x',
      fromTokenSymbol: fromToken?.symbol || 'UNKNOWN',
      toTokenSymbol: toToken?.symbol || 'UNKNOWN',
      fromTokenAddress: fromToken?.contractAddress,
      toTokenAddress: toToken?.contractAddress,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      fromAmountUsd,
      toAmountUsd,
      network: fromToken?.network || 'polygon',
      chainId: targetChainId,
      isCrossChain: quote.isDeBridge,
      routingProtocol: quote.routingProtocol || quote.route,
      orderId: quote.orderId,
    });
    currentAttemptIdRef.current = attemptId;

    try {
      isCancelledRef.current = false;
      hasCompletedRef.current = false;
      txSentRef.current = false;
      setStatusStep('validating');
      setErrorMessage(null);
      setTxHash(null);
      setDeBridgeOrderId(null);
      setStatusMessage('Verifying active wallet signing session...');

      // 1. PRE-FLIGHT VALIDATION: Check account state
      if (!isWalletConnected || !activeAddress) {
        throw new Error('Wallet connection expired. Please reconnect your wallet.');
      }

      if (!fromToken || !toToken) {
        throw new Error('Missing token configuration for swap.');
      }

      const numFromAmount = parseFloat(quote.fromAmount);
      if (!quote.fromAmount || isNaN(numFromAmount) || numFromAmount <= 0) {
        throw new Error('Please enter a valid swap amount greater than 0.');
      }

      // Check and auto-switch network if required
      if (activeChainId && activeChainId !== targetChainId && switchChainAsync) {
        setStatusStep('network');
        setStatusMessage(`Switching wallet network to ${fromToken.networkName}...`);
        try {
          await switchChainAsync({ chainId: targetChainId });
        } catch (switchErr: any) {
          console.warn('[SwapProcessingModal] Chain switch notice:', switchErr);
          const swMsg = safeFormatError(switchErr).toLowerCase();
          if (swMsg.includes('user rejected') || swMsg.includes('denied')) {
            throw new Error(`Please switch your wallet to ${fromToken.networkName} (Chain ID: ${targetChainId}) to continue.`);
          }
        }
      }

      const destChainId: number = toToken.network === 'ethereum' ? 1 : 137;
      const targetRpcClient = targetChainId === 137 ? polygonRpcClient : ethereumRpcClient;
      const explorerBase = fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';
      const isSrcNative = isNativeAddress(fromToken.contractAddress);
      const isDestNative = isNativeAddress(toToken.contractAddress);

      // 2. PRE-FLIGHT VALIDATION: Verify the actual wallet provider & signing session
      let signingSession: ActiveSigningSessionResult;
      try {
        const provider = (await connector?.getProvider()) || (window as any).ethereum;
        signingSession = await verifyActiveSigningSession({
          connector,
          appKitProvider: provider,
          expectedAccount: activeAddress,
          targetChainId,
        });
      } catch (sessErr: any) {
        console.error('[SwapProcessingModal] Signing session verification failed:', sessErr);
        throw new Error(sessErr?.message || 'Wallet connection expired. Please reconnect your wallet.');
      }

      const activeWalletAddress = signingSession.account;
      const activeProvider = signingSession.provider;

      if (isCancelledRef.current) return;

      // 3. PRE-FLIGHT VALIDATION: Request fresh executable on-chain swap quote
      setStatusStep('validating');
      setStatusMessage('Requesting executable on-chain quote...');

      const srcTokenAddr = isSrcNative ? ZERO_ADDRESS : safeGetAddress(fromToken.contractAddress);
      const dstTokenAddr = isDestNative ? ZERO_ADDRESS : safeGetAddress(toToken.contractAddress);

      const freshQuote = await getUnifiedSwapQuote({
        srcChainId: targetChainId,
        srcTokenAddress: srcTokenAddr,
        srcDecimals: fromToken.decimals || 18,
        srcSymbol: fromToken.symbol,
        srcAmount: quote.fromAmount,
        dstChainId: destChainId,
        dstTokenAddress: dstTokenAddr,
        dstDecimals: toToken.decimals || 18,
        dstSymbol: toToken.symbol,
        userAddress: activeWalletAddress,
        slippagePercent: quote.slippageTolerance || 0.5,
      });

      if (isCancelledRef.current) return;

      if (!freshQuote.success || !freshQuote.transactionTo || !freshQuote.transactionData) {
        throw new Error(freshQuote.errorMessage || 'Swap route unavailable for this token pair or size.');
      }

      const txTo = safeGetAddress(freshQuote.transactionTo);
      const txData = freshQuote.transactionData as `0x${string}`;
      const txValue = BigInt(freshQuote.transactionValue || '0');
      const spenderAddr = safeGetAddress(freshQuote.allowanceTarget || txTo);

      if (txTo === ZERO_ADDRESS || !txData || txData === '0x') {
        throw new Error('Swap route unavailable: failed to generate executable transaction data.');
      }

      if (freshQuote.orderId) {
        setDeBridgeOrderId(freshQuote.orderId);
      }

      // 4. PRE-FLIGHT VALIDATION: Real User Balance Verification
      const requiredAmount = parseUnits(quote.fromAmount, fromToken.decimals || 18);
      if (isSrcNative) {
        const nativeBal = await targetRpcClient.getBalance({ address: activeWalletAddress });
        if (nativeBal < requiredAmount) {
          throw new Error(`Insufficient ${fromToken.symbol} balance in your wallet. Required: ${quote.fromAmount} ${fromToken.symbol}`);
        }
      } else {
        const tokenAddr = safeGetAddress(fromToken.contractAddress);
        const tokenBal = (await (targetRpcClient as any).readContract({
          address: tokenAddr,
          abi: ERC20_STANDARD_ABI,
          functionName: 'balanceOf',
          args: [activeWalletAddress],
        })) as bigint;

        if (tokenBal < requiredAmount) {
          throw new Error(`Insufficient ${fromToken.symbol} balance in your wallet. Required: ${quote.fromAmount} ${fromToken.symbol}`);
        }
      }

      if (isCancelledRef.current) return;

      // 5. APPROVAL: Token Allowance & Approval (for ERC-20 tokens e.g. VERSE -> POL)
      if (!isSrcNative && fromToken.contractAddress) {
        const tokenAddr = safeGetAddress(fromToken.contractAddress);
        setStatusStep('validating');
        setStatusMessage(`Checking ${fromToken.symbol} token allowance...`);

        const currentAllowance = (await (targetRpcClient as any).readContract({
          address: tokenAddr,
          abi: ERC20_STANDARD_ABI,
          functionName: 'allowance',
          args: [activeWalletAddress, spenderAddr],
        })) as bigint;

        if (currentAllowance < requiredAmount) {
          if (isCancelledRef.current) return;

          setStatusStep('approval');
          setStatusMessage(`Please approve ${fromToken.symbol} in your connected wallet...`);

          // Prompt mobile wallet
          triggerMobileWalletPrompt(connector?.name || 'Connected Wallet');

          let approveTxHash: `0x${string}`;
          try {
            if (writeContractAsync) {
              approveTxHash = await (writeContractAsync as any)({
                address: tokenAddr,
                abi: ERC20_STANDARD_ABI,
                functionName: 'approve',
                args: [spenderAddr, requiredAmount],
                chainId: targetChainId,
              });
            } else {
              const approveCalldata = encodeFunctionData({
                abi: ERC20_STANDARD_ABI,
                functionName: 'approve',
                args: [spenderAddr, requiredAmount],
              });
              approveTxHash = await sendTransactionWithRetry(
                activeProvider,
                {
                  from: activeWalletAddress,
                  to: tokenAddr,
                  data: approveCalldata,
                  value: '0x0',
                },
                90000,
                'Token approval request timed out. Please check your wallet app.'
              );
            }
          } catch (apprErr: any) {
            const apprMsg = safeFormatError(apprErr).toLowerCase();
            if (apprMsg.includes('user rejected') || apprMsg.includes('denied') || apprMsg.includes('disapproved') || apprMsg.includes('action_rejected')) {
              throw new Error('Approval rejected in your wallet.');
            }
            throw apprErr;
          }

          if (isCancelledRef.current) return;

          setStatusStep('mining');
          setStatusMessage(`Confirming ${fromToken.symbol} approval on ${fromToken.networkName}...`);

          const approveReceipt = await targetRpcClient.waitForTransactionReceipt({
            hash: approveTxHash,
            timeout: 60000,
          });

          if (approveReceipt.status === 'reverted') {
            throw new Error(`Token approval transaction reverted on-chain. (Tx: ${approveTxHash})`);
          }
        }
      }

      if (isCancelledRef.current) return;

      // 6. COLLECT PAYFLUX ON-CHAIN PLATFORM FEE ($0.10 USD) to Revenue Wallet (0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD)
      setStatusStep('signing');
      setStatusMessage('Processing PayFlux platform fee ($0.10 USD) to revenue wallet...');

      let collectedFeeResult: FeeExecutionResult | null = null;
      try {
        collectedFeeResult = await executeAndVerifyPlatformFee({
          payerAddress: activeWalletAddress,
          chainId: targetChainId,
          tokenSymbol: fromToken.symbol,
          tokenContractAddress: fromToken.contractAddress,
          tokenDecimals: fromToken.decimals,
          tokenPriceUsd: fromToken.priceUsd,
          sendTransactionAsync,
          writeContractAsync,
          activeProvider,
        });
      } catch (feeErr) {
        console.warn('[SwapProcessingModal] Platform fee notice:', feeErr);
      }

      if (isCancelledRef.current) return;

      // 7. WALLET TRANSACTION: Prompt Connected Wallet to Sign & Send Swap Transaction
      setStatusStep('signing');
      setStatusMessage('Please confirm the swap transaction in your connected wallet...');

      // Trigger deep link to active mobile wallet
      triggerMobileWalletPrompt(connector?.name || 'Connected Wallet');

      let hash: `0x${string}`;
      try {
        if (sendTransactionAsync) {
          hash = await sendTransactionAsync({
            to: txTo,
            data: txData,
            value: txValue,
            chainId: targetChainId,
          });
        } else if (activeProvider) {
          hash = await sendTransactionWithRetry(
            activeProvider,
            {
              from: activeWalletAddress,
              to: txTo,
              data: txData,
              value: '0x' + txValue.toString(16),
            },
            90000,
            'Wallet confirmation timed out. Please check your wallet app and try again.'
          );
        } else {
          throw new Error('No active wallet signing provider available.');
        }
        txSentRef.current = true;
      } catch (sendErr: any) {
        console.warn('[SwapProcessingModal] Transaction signing error:', sendErr);
        const errStr = safeFormatError(sendErr).toLowerCase();
        if (
          errStr.includes('user rejected') ||
          errStr.includes('user denied') ||
          errStr.includes('rejected by user') ||
          errStr.includes('reject by the user') ||
          errStr.includes('action_rejected')
        ) {
          throw new Error('Transaction rejected in your wallet.');
        }
        throw sendErr;
      }

      if (isCancelledRef.current) return;

      // 8. Capture Real Hash & Update UI to mining / confirming state
      setTxHash(hash);
      setStatusStep('mining');
      setStatusMessage('Transaction submitted — confirming on-chain...');

      if (currentAttemptIdRef.current) {
        updateSwapTxHash(currentAttemptIdRef.current, hash, `${explorerBase}/tx/${hash}`);
      }

      // 9. Monitor Transaction Confirmation on Blockchain
      const receipt = await targetRpcClient.waitForTransactionReceipt({
        hash,
        timeout: 90000,
      });

      if (receipt.status === 'reverted') {
        throw new Error(`Transaction reverted on-chain (Tx: ${hash}). View: ${explorerBase}/tx/${hash}`);
      }

      // 10. If Cross-Chain Swap (deBridge), track order fulfillment
      if (freshQuote.isCrossChain && freshQuote.orderId) {
        setStatusStep('crosschain');
        setStatusMessage('Source transaction confirmed! Cross-chain solver is fulfilling destination asset...');

        let isSettled = false;
        const startTime = Date.now();
        while (!isSettled && Date.now() - startTime < 60000) {
          if (isCancelledRef.current) return;
          await new Promise((resolve) => setTimeout(resolve, 3500));
          try {
            const orderStatus = await checkDeBridgeOrderStatus(freshQuote.orderId);
            if (
              orderStatus.state === 'Fulfilled' ||
              orderStatus.state === 'Executed' ||
              orderStatus.state === 'ClaimedUnlock'
            ) {
              isSettled = true;
              break;
            }
          } catch {
            // Keep polling
          }
        }
      }

      // 11. Transaction SUCCESS -> Trigger balance refresh and notify parent ONCE
      if (hasCompletedRef.current) return;
      hasCompletedRef.current = true;
      isExecutingRef.current = false;

      setStatusStep('success');
      setStatusMessage('Swap successfully confirmed on-chain!');

      const verifiedFeeDetails = collectedFeeResult?.success && collectedFeeResult.feeTxHash ? {
        feeTxHash: collectedFeeResult.feeTxHash,
        feeBlockNumber: collectedFeeResult.feeBlockNumber,
        feeVerified: true,
        feeRecipient: collectedFeeResult.feeRecipient || PAYFLUX_TREASURY_ADDRESS,
        feeToken: collectedFeeResult.feeTokenSymbol,
        feeAmountToken: collectedFeeResult.feeAmountToken,
        payfluxFeeUsd: collectedFeeResult.feeAmountUsd,
        feeStatus: 'confirmed' as const,
      } : {
        feeVerified: false,
        feeStatus: 'uncollected' as const,
        payfluxFeeUsd: 0,
        feeRecipient: PAYFLUX_TREASURY_ADDRESS,
      };

      if (currentAttemptIdRef.current) {
        recordSwapSuccess(currentAttemptIdRef.current, {
          txHash: hash,
          blockNumber: Number(receipt.blockNumber),
          explorerUrl: `${explorerBase}/tx/${hash}`,
          orderId: freshQuote.orderId,
          feeDetails: verifiedFeeDetails,
        });
      }

      onComplete({
        hash,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `${explorerBase}/tx/${hash}`,
        orderId: freshQuote.orderId,
      });
    } catch (err: any) {
      console.error('Swap execution error:', safeFormatError(err));
      setStatusStep('error');

      const rawFormattedMsg = safeFormatError(err);
      const lowerMsg = rawFormattedMsg.toLowerCase();
      let determinedError = rawFormattedMsg;
      let failureStatus: 'failed' | 'rejected' | 'cancelled' = 'failed';

      if (
        lowerMsg.includes('user rejected') ||
        lowerMsg.includes('user denied') ||
        lowerMsg.includes('action_rejected') ||
        lowerMsg.includes('rejected by user') ||
        lowerMsg.includes('reject by the user')
      ) {
        determinedError = 'Transaction rejected in your wallet.';
        failureStatus = 'rejected';
      } else if (
        lowerMsg.includes('wallet connection expired') ||
        lowerMsg.includes('please reconnect your wallet')
      ) {
        determinedError = 'Wallet connection expired. Please reconnect your wallet.';
      } else if (
        lowerMsg.includes('failed to publish payload') ||
        lowerMsg.includes('tag:1108')
      ) {
        determinedError = 'WalletConnect connection was temporarily interrupted. Please ensure your wallet app is open and tap Retry.';
      } else if (
        lowerMsg.includes('insufficient funds') ||
        lowerMsg.includes('exceeds balance') ||
        lowerMsg.includes('gas * price + value')
      ) {
        determinedError = `Insufficient ${quote.fromToken.symbol} balance to cover swap amount plus gas fee.`;
      } else if (lowerMsg.includes('reverted')) {
        determinedError = 'Transaction reverted on blockchain.';
      }

      setErrorMessage(determinedError);

      if (currentAttemptIdRef.current) {
        recordSwapFailure(currentAttemptIdRef.current, determinedError, txHash || undefined, failureStatus);
      }
    }
  };

  useEffect(() => {
    if (!isOpen || !quote) {
      setStatusStep('validating');
      setErrorMessage(null);
      setTxHash(null);
      setDeBridgeOrderId(null);
      isExecutingRef.current = false;
      hasCompletedRef.current = false;
      isCancelledRef.current = true;
      txSentRef.current = false;
      return;
    }

    if (isExecutingRef.current || hasCompletedRef.current) return;
    isExecutingRef.current = true;

    executeRealSwap();
  }, [isOpen, quote]);

  const handleAbort = () => {
    isCancelledRef.current = true;
    isExecutingRef.current = false;
    hasCompletedRef.current = false;
    if (currentAttemptIdRef.current && statusStep !== 'success') {
      recordSwapFailure(currentAttemptIdRef.current, 'Swap request cancelled by user.', txHash || undefined, 'cancelled');
    }
    onClose();
  };

  if (!isOpen || !quote) return null;

  const explorerBase = quote.fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="swap-processing-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-slate-100 text-center animate-in zoom-in-95 duration-150 relative"
      >
        {/* Close / Cancel Button in Header for active non-final steps */}
        {statusStep !== 'success' && statusStep !== 'error' && (
          <button
            id="btn-swap-cancel-modal"
            onClick={handleAbort}
            title="Cancel swap request"
            className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {statusStep === 'error' ? (
          /* Error State - No balances changed */
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-rose-500/15 border-2 border-rose-500/40 text-rose-400 mx-auto flex items-center justify-center shadow-lg shadow-rose-950/40">
              <XCircle className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-black text-white">Swap Notice</h3>
            <p className="text-xs text-slate-400">
              Your transaction was not executed and no wallet balances were changed.
            </p>
            <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-900/50 text-xs text-rose-300 font-mono text-left break-words">
              {errorMessage || 'Unknown blockchain error occurred.'}
            </div>

            {txHash && (
              <a
                href={`${explorerBase}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-rose-400 hover:underline font-mono"
              >
                <span>View failed transaction on Explorer</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              {(errorMessage || '').toLowerCase().includes('reconnect') ? (
                <button
                  id="btn-swap-reconnect"
                  onClick={async () => {
                    onClose();
                    try {
                      await open({ view: 'Connect' });
                    } catch (e) {
                      console.error('Reconnect open error:', e);
                    }
                  }}
                  className="flex-1 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-bold text-xs text-white transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-900/30"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Reconnect Wallet</span>
                </button>
              ) : (
                <button
                  id="btn-swap-retry"
                  onClick={() => {
                    isExecutingRef.current = false;
                    hasCompletedRef.current = false;
                    executeRealSwap();
                  }}
                  className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 font-bold text-xs text-white transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-purple-900/30"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Retry</span>
                </button>
              )}
              <button
                id="btn-swap-close-error"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs text-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : statusStep === 'success' ? (
          /* Success State */
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-black text-white">Swap Complete!</h3>
            <p className="text-xs text-slate-400 font-mono">
              {quote.fromAmount} {quote.fromToken.symbol} → ~{quote.toAmount} {quote.toToken.symbol}
            </p>
            {txHash && (
              <a
                href={`${explorerBase}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:underline font-mono"
              >
                <span>View Blockchain Receipt</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              id="btn-swap-done"
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white transition-colors shadow-lg shadow-emerald-950/40"
            >
              Done
            </button>
          </div>
        ) : (
          /* Progress / Signing / Mining State */
          <>
            {/* Animated Central Pulse Loader */}
            <div className="relative w-20 h-20 mx-auto mb-6 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping opacity-75" />
              <div
                className="absolute inset-2 rounded-full bg-gradient-to-tr from-cyan-500 via-purple-500 to-blue-600 animate-spin"
                style={{ animationDuration: '3s' }}
              />
              <div className="relative w-14 h-14 rounded-full bg-slate-900 flex items-center justify-center border-2 border-cyan-400">
                <Zap className="w-6 h-6 text-cyan-400 fill-cyan-400 animate-pulse" />
              </div>
            </div>

            <h3 className="text-lg font-extrabold text-white mb-1">
              {quote.isDeBridge ? 'Executing Cross-Chain Swap' : 'Processing On-Chain Swap'}
            </h3>
            <p className="text-xs text-slate-400 mb-5 font-mono">
              {quote.fromAmount} {quote.fromToken.symbol} → ~{quote.toAmount} {quote.toToken.symbol}
            </p>

            {/* Status box */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-left space-y-2 mb-4">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400 flex-shrink-0" />
                <span>{statusMessage}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {statusStep === 'network'
                  ? `Please confirm network switch to ${quote.fromToken.networkName} in your wallet.`
                  : statusStep === 'approval'
                  ? 'Please confirm the token spend allowance in your connected wallet popup.'
                  : statusStep === 'signing'
                  ? 'Please review and confirm the transaction in your connected wallet app.'
                  : statusStep === 'crosschain'
                  ? 'Source block confirmed. Decentralized solvers are executing destination asset transfer...'
                  : statusStep === 'mining'
                  ? `Transaction submitted — confirming on-chain (${quote.fromToken.networkName})...`
                  : 'Verifying active wallet provider session and smart contract routing.'}
              </p>

              {/* Mobile Quick Launcher if in signing or approval step */}
              {(statusStep === 'signing' || statusStep === 'approval') && (
                <button
                  id="btn-open-wallet-app"
                  onClick={() => triggerMobileWalletPrompt(connector?.name || 'Connected Wallet')}
                  className="mt-2 w-full py-2 px-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Open Wallet App to Confirm</span>
                </button>
              )}

              {txHash && (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Transaction</span>
                  <a
                    href={`${explorerBase}/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline flex items-center gap-1 font-mono"
                  >
                    <span>View on Explorer</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {deBridgeOrderId && (
                <div className="pt-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Globe className="w-3 h-3 text-purple-400" />
                    <span>deBridge Order</span>
                  </span>
                  <a
                    href={`https://app.debridge.finance/order?orderId=${deBridgeOrderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-300 hover:underline font-mono"
                  >
                    Track Cross-Chain
                  </a>
                </div>
              )}
            </div>

            {/* Cancel Action to prevent stuck UI */}
            <div className="pt-1">
              <button
                id="btn-swap-cancel-action"
                onClick={handleAbort}
                className="w-full py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs transition-colors"
              >
                Cancel Swap
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
