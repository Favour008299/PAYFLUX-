import React, { useEffect, useState, useRef } from 'react';
import {
  Loader2,
  Zap,
  ExternalLink,
  XCircle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { SwapQuote, TransactionRecord } from '../types';
import { usePublicClient, useAccount, useSendTransaction, useWriteContract } from 'wagmi';
import { parseUnits } from 'viem';
import {
  safeGetAddress,
  isNativeAddress,
  ERC20_STANDARD_ABI,
  getUnifiedSwapQuote,
  ZERO_ADDRESS,
} from '../services/sharedSwapEngine';

interface SwapProcessingModalProps {
  isOpen: boolean;
  quote: SwapQuote | null;
  onComplete: (txRecord: Partial<TransactionRecord>) => void;
  onClose: () => void;
}

export const SwapProcessingModal: React.FC<SwapProcessingModalProps> = ({
  isOpen,
  quote,
  onComplete,
  onClose,
}) => {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [statusStep, setStatusStep] = useState<'validating' | 'approval' | 'signing' | 'mining' | 'success' | 'error'>('validating');
  const [statusMessage, setStatusMessage] = useState<string>('Validating liquidity route...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const isExecutingRef = useRef(false);

  const executeRealSwap = async () => {
    if (!quote || !publicClient) return;

    try {
      setStatusStep('validating');
      setErrorMessage(null);
      setStatusMessage('Validating route parameters and wallet authorization...');

      if (!address || !isConnected) {
        throw new Error('Please connect your Web3 wallet before executing a swap transaction.');
      }

      const fromToken = quote.fromToken;
      const userAddr = safeGetAddress(address);
      const isSrcNative = isNativeAddress(fromToken.contractAddress);
      const isEth = fromToken.network === 'ethereum';
      const explorerBase = isEth ? 'https://etherscan.io' : 'https://polygonscan.com';

      // 1. Ensure we have the executable transaction payload
      let activeTx = quote.swapTx || quote.deBridgeTx;

      if (!activeTx || !activeTx.data || !activeTx.to || activeTx.to === ZERO_ADDRESS) {
        setStatusMessage('Building executable DEX transaction payload...');
        const freshQuote = await getUnifiedSwapQuote({
          srcChainId: isEth ? 1 : 137,
          srcTokenAddress: fromToken.contractAddress || ZERO_ADDRESS,
          srcDecimals: fromToken.decimals,
          srcSymbol: fromToken.symbol,
          srcAmount: quote.fromAmount,
          dstChainId: quote.toToken.network === 'ethereum' ? 1 : 137,
          dstTokenAddress: quote.toToken.contractAddress || ZERO_ADDRESS,
          dstDecimals: quote.toToken.decimals,
          dstSymbol: quote.toToken.symbol,
          userAddress: userAddr,
          slippagePercent: quote.slippageTolerance || 0.5,
        });

        if (!freshQuote.success || !freshQuote.transactionTo || !freshQuote.transactionData) {
          throw new Error(freshQuote.errorMessage || 'Unable to build on-chain transaction payload. Please try again.');
        }

        activeTx = {
          to: safeGetAddress(freshQuote.transactionTo),
          data: freshQuote.transactionData as `0x${string}`,
          value: freshQuote.transactionValue || '0',
          allowanceTarget: freshQuote.allowanceTarget ? safeGetAddress(freshQuote.allowanceTarget) : undefined,
        };
      }

      const txTo = safeGetAddress(activeTx.to);
      const txData = activeTx.data;
      const txValue = BigInt(activeTx.value || '0');
      const spenderAddr = safeGetAddress(activeTx.allowanceTarget || txTo);

      // 2. Token Allowance check & approval if not native gas token
      if (!isSrcNative && fromToken.contractAddress) {
        const tokenAddr = safeGetAddress(fromToken.contractAddress);
        const requiredAmount = parseUnits(quote.fromAmount, fromToken.decimals);

        setStatusStep('validating');
        setStatusMessage(`Checking ${fromToken.symbol} token allowance on ${fromToken.networkName}...`);

        try {
          const currentAllowance = (await (publicClient as any).readContract({
            address: tokenAddr,
            abi: ERC20_STANDARD_ABI,
            functionName: 'allowance',
            args: [userAddr, spenderAddr],
          })) as bigint;

          if (currentAllowance < requiredAmount) {
            setStatusStep('approval');
            setStatusMessage(`Please approve ${fromToken.symbol} in your wallet...`);

            const approveTxHash = await (writeContractAsync as any)({
              address: tokenAddr,
              abi: ERC20_STANDARD_ABI,
              functionName: 'approve',
              args: [spenderAddr, requiredAmount],
            });

            setStatusStep('mining');
            setStatusMessage(`Confirming ${fromToken.symbol} approval on ${fromToken.networkName}...`);

            await publicClient.waitForTransactionReceipt({
              hash: approveTxHash,
              timeout: 60000,
            });
          }
        } catch (allowanceErr: any) {
          console.warn('Allowance approval step error:', allowanceErr);
          const errText = allowanceErr.message || '';
          if (errText.includes('User rejected') || errText.includes('denied') || errText.includes('rejected')) {
            throw new Error('Token approval was rejected in your wallet.');
          }
          throw allowanceErr;
        }
      }

      // 3. Request Swap Signature from connected wallet
      setStatusStep('signing');
      setStatusMessage('Please confirm the swap transaction in your connected wallet...');

      const hash = await sendTransactionAsync({
        to: txTo,
        data: txData as `0x${string}`,
        value: txValue,
      });

      setTxHash(hash);
      setStatusStep('mining');
      setStatusMessage(`Transaction broadcasted. Awaiting confirmation on ${fromToken.networkName}...`);

      // 4. Wait for blockchain confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 60000,
      });

      if (receipt.status === 'reverted') {
        throw new Error(`Transaction reverted on-chain (Tx: ${hash}). View: ${explorerBase}/tx/${hash}`);
      }

      setStatusStep('success');
      setStatusMessage('Swap successfully confirmed on-chain!');

      onComplete({
        hash,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `${explorerBase}/tx/${hash}`,
        orderId: quote.orderId,
      });
    } catch (err: any) {
      console.error('Swap execution error:', err);
      setStatusStep('error');
      const msg = err.message || 'Transaction failed or rejected by wallet.';
      setErrorMessage(
        msg.includes('User rejected') || msg.includes('denied')
          ? 'Transaction signature was rejected in your wallet.'
          : msg
      );
    }
  };

  useEffect(() => {
    if (!isOpen || !quote) {
      setStatusStep('validating');
      setErrorMessage(null);
      setTxHash(null);
      isExecutingRef.current = false;
      return;
    }

    if (isExecutingRef.current) return;
    isExecutingRef.current = true;

    executeRealSwap();
  }, [isOpen, quote]);

  if (!isOpen || !quote) return null;

  const explorerBase = quote.fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="swap-processing-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-slate-100 text-center animate-in zoom-in-95 duration-150"
      >
        {statusStep === 'error' ? (
          /* Error State */
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-rose-500/15 border-2 border-rose-500/40 text-rose-400 mx-auto flex items-center justify-center">
              <XCircle className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-black text-white">Swap Failed</h3>
            <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-900/50 text-xs text-rose-300 font-mono text-left break-words">
              {errorMessage || 'Unknown blockchain error occurred.'}
            </div>
            <div className="flex gap-2">
              <button
                id="btn-swap-retry"
                onClick={() => {
                  isExecutingRef.current = false;
                  executeRealSwap();
                }}
                className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 font-bold text-xs text-white transition-colors flex items-center justify-center gap-1.5"
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
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center">
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
                <span>View Transaction</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              id="btn-swap-done"
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          /* Progress / Mining State */
          <>
            {/* Animated Central Pulse Loader */}
            <div className="relative w-20 h-20 mx-auto mb-6 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-purple-500/20 animate-ping opacity-75" />
              <div
                className="absolute inset-2 rounded-full bg-gradient-to-tr from-cyan-500 via-purple-500 to-blue-600 animate-spin"
                style={{ animationDuration: '3s' }}
              />
              <div className="relative w-14 h-14 rounded-full bg-slate-900 flex items-center justify-center border-2 border-purple-400">
                <Zap className="w-6 h-6 text-purple-400 fill-purple-400 animate-pulse" />
              </div>
            </div>

            <h3 className="text-lg font-extrabold text-white mb-1">
              {quote.isDeBridge ? 'Executing Cross-Chain Swap' : 'Processing Swap'}
            </h3>
            <p className="text-xs text-slate-400 mb-6 font-mono">
              {quote.fromAmount} {quote.fromToken.symbol} → ~{quote.toAmount} {quote.toToken.symbol}
            </p>

            {/* Status box */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-left space-y-2 mb-6">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400 flex-shrink-0" />
                <span>{statusMessage}</span>
              </div>
              <p className="text-[11px] text-slate-400">
                {statusStep === 'approval'
                  ? 'Please confirm the token spend allowance in your wallet extension/popup.'
                  : statusStep === 'signing'
                  ? 'Review the transaction details and sign the transaction in your connected wallet.'
                  : statusStep === 'mining'
                  ? `Transaction has been submitted. Awaiting block confirmation on ${quote.fromToken.networkName || 'blockchain'}...`
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
            </div>

            <p className="text-[11px] text-slate-500">
              Please do not close this window until the blockchain transaction is confirmed.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
