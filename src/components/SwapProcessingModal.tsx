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
  X
} from 'lucide-react';
import { SwapQuote, TransactionRecord } from '../types';
import { useAccount, useSendTransaction, useWriteContract, useSwitchChain } from 'wagmi';
import { parseUnits } from 'viem';
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

interface SwapProcessingModalProps {
  isOpen: boolean;
  quote: SwapQuote | null;
  onComplete: (txRecord: Partial<TransactionRecord>) => void;
  onClose: () => void;
}

/**
 * Promise wrapper to guarantee wallet calls never hang indefinitely
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutErrorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutErrorMessage));
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export const SwapProcessingModal: React.FC<SwapProcessingModalProps> = ({
  isOpen,
  quote,
  onComplete,
  onClose,
}) => {
  const { address, isConnected, chainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [statusStep, setStatusStep] = useState<
    'validating' | 'network' | 'approval' | 'signing' | 'mining' | 'crosschain' | 'success' | 'error'
  >('validating');
  const [statusMessage, setStatusMessage] = useState<string>('Validating liquidity route...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [deBridgeOrderId, setDeBridgeOrderId] = useState<string | null>(null);
  const isExecutingRef = useRef(false);
  const isCancelledRef = useRef(false);

  const executeRealSwap = async () => {
    if (!quote) return;

    try {
      isCancelledRef.current = false;
      setStatusStep('validating');
      setErrorMessage(null);
      setTxHash(null);
      setDeBridgeOrderId(null);
      setStatusMessage('Validating swap parameters and route...');

      // 1. Validate connected wallet
      if (!address || !isConnected) {
        throw new Error('Please connect your Web3 wallet before executing a swap transaction.');
      }

      const userAddr = safeGetAddress(address);
      if (userAddr === ZERO_ADDRESS) {
        throw new Error('Invalid connected wallet address.');
      }

      const fromToken = quote.fromToken;
      const toToken = quote.toToken;

      // 2. Validate token parameters
      if (!fromToken || !toToken) {
        throw new Error('Missing token configuration for swap.');
      }

      const numFromAmount = parseFloat(quote.fromAmount);
      if (!quote.fromAmount || isNaN(numFromAmount) || numFromAmount <= 0) {
        throw new Error('Please enter a valid swap amount greater than 0.');
      }

      const targetChainId = fromToken.network === 'ethereum' ? 1 : 137;
      const destChainId = toToken.network === 'ethereum' ? 1 : 137;
      const targetRpcClient = targetChainId === 137 ? polygonRpcClient : ethereumRpcClient;
      const explorerBase = fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';
      const isSrcNative = isNativeAddress(fromToken.contractAddress);
      const isDestNative = isNativeAddress(toToken.contractAddress);

      // 3. Switch chain if wallet is connected to a different network
      if (chainId && chainId !== targetChainId && switchChainAsync) {
        setStatusStep('network');
        setStatusMessage(`Switching wallet network to ${fromToken.networkName}...`);
        try {
          await withTimeout(
            switchChainAsync({ chainId: targetChainId }),
            30000,
            `Network switch to ${fromToken.networkName} timed out. Please switch networks in your wallet.`
          );
        } catch (switchErr: any) {
          console.warn('[SwapProcessingModal] Network switch notice:', switchErr);
          const sMsg = (switchErr?.message || '').toLowerCase();
          if (sMsg.includes('user rejected') || sMsg.includes('denied') || sMsg.includes('rejected')) {
            throw new Error(`Please switch your wallet network to ${fromToken.networkName} (Chain ID: ${targetChainId}) to continue.`);
          }
        }
      }

      if (isCancelledRef.current) return;

      // 4. Request fresh, executable on-chain swap route quote
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
        userAddress: userAddr,
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

      console.log('[PayFlux Swap Processing] Verified parameters & ready for execution:', {
        srcChainId: targetChainId,
        srcSymbol: fromToken.symbol,
        dstSymbol: toToken.symbol,
        userAddress: userAddr,
        txTo,
        txValue: txValue.toString(),
        spenderAddr,
        isSrcNative,
      });

      // 5. Verify user has sufficient real balance on-chain
      const requiredAmount = parseUnits(quote.fromAmount, fromToken.decimals || 18);
      if (isSrcNative) {
        const nativeBal = await targetRpcClient.getBalance({ address: userAddr });
        if (nativeBal < requiredAmount) {
          throw new Error(`Insufficient ${fromToken.symbol} balance in your wallet. Required: ${quote.fromAmount} ${fromToken.symbol}`);
        }
      } else {
        const tokenAddr = safeGetAddress(fromToken.contractAddress);
        const tokenBal = (await (targetRpcClient as any).readContract({
          address: tokenAddr,
          abi: ERC20_STANDARD_ABI,
          functionName: 'balanceOf',
          args: [userAddr],
        })) as bigint;

        if (tokenBal < requiredAmount) {
          throw new Error(`Insufficient ${fromToken.symbol} balance in your wallet. Required: ${quote.fromAmount} ${fromToken.symbol}`);
        }
      }

      if (isCancelledRef.current) return;

      // 6. Token Allowance & Approval (for ERC-20 tokens)
      if (!isSrcNative && fromToken.contractAddress) {
        const tokenAddr = safeGetAddress(fromToken.contractAddress);
        setStatusStep('validating');
        setStatusMessage(`Checking ${fromToken.symbol} token allowance...`);

        const currentAllowance = (await (targetRpcClient as any).readContract({
          address: tokenAddr,
          abi: ERC20_STANDARD_ABI,
          functionName: 'allowance',
          args: [userAddr, spenderAddr],
        })) as bigint;

        if (currentAllowance < requiredAmount) {
          if (isCancelledRef.current) return;

          setStatusStep('approval');
          setStatusMessage(`Please approve ${fromToken.symbol} in your connected wallet...`);

          const approveTxHash = await withTimeout<`0x${string}`>(
            (writeContractAsync as any)({
              chainId: targetChainId,
              address: tokenAddr,
              abi: ERC20_STANDARD_ABI,
              functionName: 'approve',
              args: [spenderAddr, requiredAmount],
              account: userAddr,
            }),
            60000,
            'Token approval request timed out. Please check your wallet popup.'
          );

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

      // 7. Prompt Connected Wallet to Sign & Send Swap Transaction
      setStatusStep('signing');
      setStatusMessage('Please confirm the swap transaction in your connected wallet...');

      // Dynamic gas estimation to catch execution reverts before sending to wallet
      let estimatedGas: bigint | undefined = undefined;
      try {
        const rawGas = await targetRpcClient.estimateGas({
          account: userAddr,
          to: txTo,
          data: txData,
          value: txValue,
        });
        const buffered = (rawGas * 125n) / 100n;
        estimatedGas = buffered < 200000n ? 200000n : buffered;
      } catch (gasErr: any) {
        console.warn('[SwapProcessingModal] Pre-flight gas estimation note:', gasErr);
        const gMsg = (gasErr?.shortMessage || gasErr?.details || gasErr?.message || '').toLowerCase();
        if (gMsg.includes('insufficient funds') || gMsg.includes('exceeds the balance') || gMsg.includes('gas * price + value')) {
          throw new Error(`Insufficient ${fromToken.symbol} balance to cover the swap amount plus network gas fees.`);
        }
        if (gMsg.includes('reverted') || gMsg.includes('execution reverted')) {
          throw new Error('On-chain simulation reverted. Slippage tolerance may be too low or liquidity moved.');
        }
        // Fallback default
        estimatedGas = freshQuote.isCrossChain ? 450000n : 280000n;
      }

      const txParams: any = {
        chainId: targetChainId,
        to: txTo,
        data: txData,
        value: txValue,
        account: userAddr,
      };

      if (estimatedGas) {
        txParams.gas = estimatedGas;
      }

      console.log('[PayFlux Swap Processing] Dispatching transaction to wallet:', txParams);

      // Enforce 60-second timeout on wallet response
      const hash = await withTimeout<`0x${string}`>(
        sendTransactionAsync(txParams),
        60000,
        'Wallet confirmation timed out. Please check your wallet popup and try again.'
      );

      if (isCancelledRef.current) return;

      // 8. Capture Real Hash & Update UI to confirming state
      setTxHash(hash);
      setStatusStep('mining');
      setStatusMessage('Transaction submitted — confirming on-chain...');

      // 9. Monitor Transaction Confirmation
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

      // 11. Transaction SUCCESS -> Trigger balance refresh and notify parent
      setStatusStep('success');
      setStatusMessage('Swap successfully confirmed on-chain!');

      onComplete({
        hash,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `${explorerBase}/tx/${hash}`,
        orderId: freshQuote.orderId,
      });
    } catch (err: any) {
      console.error('Swap execution error:', err);
      setStatusStep('error');

      let msg = 'Transaction failed or rejected by wallet.';
      if (typeof err === 'string') {
        msg = err;
      } else if (typeof err?.shortMessage === 'string' && err.shortMessage.trim()) {
        msg = err.shortMessage;
      } else if (typeof err?.details === 'string' && err.details.trim()) {
        msg = err.details;
      } else if (typeof err?.message === 'string' && err.message.trim()) {
        msg = err.message;
      } else {
        try {
          msg = JSON.stringify(err, (_key, val) =>
            typeof val === 'bigint' ? val.toString() : val
          );
        } catch {
          msg = String(err);
        }
      }

      const lowerMsg = msg.toLowerCase();
      if (
        lowerMsg.includes('user rejected') ||
        lowerMsg.includes('user denied') ||
        lowerMsg.includes('action_rejected') ||
        lowerMsg.includes('rejected by user')
      ) {
        setErrorMessage('Transaction rejected in your wallet.');
      } else if (
        lowerMsg.includes('insufficient funds') ||
        lowerMsg.includes('exceeds balance') ||
        lowerMsg.includes('gas * price + value')
      ) {
        setErrorMessage(`Insufficient ${quote.fromToken.symbol} balance to cover swap amount plus gas fee.`);
      } else if (lowerMsg.includes('timed out')) {
        setErrorMessage(msg);
      } else if (lowerMsg.includes('swap route unavailable')) {
        setErrorMessage(msg);
      } else {
        setErrorMessage(msg);
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
      isCancelledRef.current = true;
      return;
    }

    if (isExecutingRef.current) return;
    isExecutingRef.current = true;

    executeRealSwap();
  }, [isOpen, quote]);

  const handleAbort = () => {
    isCancelledRef.current = true;
    isExecutingRef.current = false;
    onClose();
  };

  if (!isOpen || !quote) return null;

  const explorerBase = quote.fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';

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
            <h3 className="text-lg font-black text-white">Swap Failed</h3>
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

            <div className="flex gap-2 pt-2">
              <button
                id="btn-swap-retry"
                onClick={() => {
                  isExecutingRef.current = false;
                  executeRealSwap();
                }}
                className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 font-bold text-xs text-white transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-purple-900/30"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Swap</span>
              </button>
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
                  ? 'Please confirm the token spend allowance in your wallet popup.'
                  : statusStep === 'signing'
                  ? 'Review and sign the transaction in your connected wallet. (Timeout: 60s)'
                  : statusStep === 'crosschain'
                  ? 'Source block confirmed. Decentralized solvers are executing destination asset transfer...'
                  : statusStep === 'mining'
                  ? `Transaction submitted — confirming on-chain (${quote.fromToken.networkName})...`
                  : 'Validating smart contract route parameters and liquidity depth.'}
              </p>

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
                    <ExternalLink className="w-3 h-3" />
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
