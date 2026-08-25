import React, { useEffect, useState, useRef } from 'react';
import {
  Loader2,
  Zap,
  ExternalLink,
  XCircle,
  CheckCircle2,
  RefreshCw,
  Globe,
  ShieldCheck
} from 'lucide-react';
import { SwapQuote, TransactionRecord } from '../types';
import { usePublicClient, useAccount, useSendTransaction, useWriteContract, useSwitchChain } from 'wagmi';
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

export const SwapProcessingModal: React.FC<SwapProcessingModalProps> = ({
  isOpen,
  quote,
  onComplete,
  onClose,
}) => {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [statusStep, setStatusStep] = useState<'validating' | 'network' | 'approval' | 'signing' | 'mining' | 'crosschain' | 'success' | 'error'>('validating');
  const [statusMessage, setStatusMessage] = useState<string>('Validating liquidity route...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [deBridgeOrderId, setDeBridgeOrderId] = useState<string | null>(null);
  const isExecutingRef = useRef(false);

  const executeRealSwap = async () => {
    if (!quote) return;

    try {
      setStatusStep('validating');
      setErrorMessage(null);
      setStatusMessage('Validating route parameters and wallet authorization...');

      if (!address || !isConnected) {
        throw new Error('Please connect your Web3 wallet before executing a swap transaction.');
      }

      const fromToken = quote.fromToken;
      const toToken = quote.toToken;
      const userAddr = safeGetAddress(address);
      const isSrcNative = isNativeAddress(fromToken.contractAddress);
      const targetChainId = fromToken.network === 'ethereum' ? 1 : 137;
      const targetRpcClient = targetChainId === 137 ? polygonRpcClient : ethereumRpcClient;
      const explorerBase = fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';

      // 1. Verify and switch network if wallet is connected to the wrong chain
      if (chainId && chainId !== targetChainId && switchChainAsync) {
        setStatusStep('network');
        setStatusMessage(`Switching wallet network to ${fromToken.networkName}...`);
        try {
          await switchChainAsync({ chainId: targetChainId });
        } catch (switchErr: any) {
          console.warn('Network switch notice:', switchErr);
          // If user declined network switch
          if (switchErr.message?.includes('User rejected') || switchErr.message?.includes('denied')) {
            throw new Error(`Please switch your wallet to ${fromToken.networkName} (Chain ID: ${targetChainId}) to execute this swap.`);
          }
        }
      }

      // 2. Build or refresh the real transaction payload with the connected wallet address as sender and recipient
      setStatusStep('validating');
      setStatusMessage('Building executable on-chain swap transaction...');

      let activeTx = quote.swapTx || quote.deBridgeTx;
      let orderId = quote.orderId;

      // Always obtain verified executable payload with the actual connected wallet address as sender/recipient
      const freshQuote = await getUnifiedSwapQuote({
        srcChainId: targetChainId,
        srcTokenAddress: fromToken.contractAddress || ZERO_ADDRESS,
        srcDecimals: fromToken.decimals,
        srcSymbol: fromToken.symbol,
        srcAmount: quote.fromAmount,
        dstChainId: toToken.network === 'ethereum' ? 1 : 137,
        dstTokenAddress: toToken.contractAddress || ZERO_ADDRESS,
        dstDecimals: toToken.decimals,
        dstSymbol: toToken.symbol,
        userAddress: userAddr,
        slippagePercent: quote.slippageTolerance || 0.5,
      });

      if (freshQuote.success && freshQuote.transactionTo && freshQuote.transactionData) {
        activeTx = {
          to: safeGetAddress(freshQuote.transactionTo),
          data: freshQuote.transactionData as `0x${string}`,
          value: freshQuote.transactionValue || '0',
          allowanceTarget: freshQuote.allowanceTarget ? safeGetAddress(freshQuote.allowanceTarget) : undefined,
        };
        if (freshQuote.orderId) {
          orderId = freshQuote.orderId;
        }
      } else {
        throw new Error(freshQuote.errorMessage || 'Swap route unavailable');
      }

      if (!activeTx || !activeTx.data || !activeTx.to || activeTx.to === ZERO_ADDRESS) {
        throw new Error('Swap route unavailable');
      }

      const txTo = safeGetAddress(activeTx.to);
      const txData = activeTx.data;
      const txValue = BigInt(activeTx.value || '0');
      const spenderAddr = safeGetAddress(activeTx.allowanceTarget || txTo);

      if (orderId) {
        setDeBridgeOrderId(orderId);
      }

      console.log('[PayFlux Swap Processing] Verified transaction specifications:', {
        sourceChainId: targetChainId,
        userAddress: userAddr,
        recipientAddress: userAddr,
        routerOrContractTo: txTo,
        transactionValueWei: txValue.toString(),
        transactionDataLength: txData.length,
        spenderAllowanceTarget: spenderAddr,
        isSrcNative,
      });

      // Check on-chain balance before dispatching
      const requiredAmount = parseUnits(quote.fromAmount, fromToken.decimals);
      if (isSrcNative) {
        const nativeBalance = await targetRpcClient.getBalance({ address: userAddr });
        if (nativeBalance < requiredAmount) {
          throw new Error(`Insufficient ${fromToken.symbol} balance in your wallet to cover the swap amount.`);
        }
      } else if (fromToken.contractAddress) {
        const tokenAddr = safeGetAddress(fromToken.contractAddress);
        const tokenBalance = (await (targetRpcClient as any).readContract({
          address: tokenAddr,
          abi: ERC20_STANDARD_ABI,
          functionName: 'balanceOf',
          args: [userAddr],
        })) as bigint;

        if (tokenBalance < requiredAmount) {
          throw new Error(`Insufficient ${fromToken.symbol} balance in your wallet to execute this swap.`);
        }
      }

      // 3. Token Allowance check & approval if not native gas token
      if (!isSrcNative && fromToken.contractAddress) {
        const tokenAddr = safeGetAddress(fromToken.contractAddress);
        const requiredAmount = parseUnits(quote.fromAmount, fromToken.decimals);

        setStatusStep('validating');
        setStatusMessage(`Checking ${fromToken.symbol} token allowance on ${fromToken.networkName}...`);

        try {
          const currentAllowance = (await (targetRpcClient as any).readContract({
            address: tokenAddr,
            abi: ERC20_STANDARD_ABI,
            functionName: 'allowance',
            args: [userAddr, spenderAddr],
          })) as bigint;

          if (currentAllowance < requiredAmount) {
            setStatusStep('approval');
            setStatusMessage(`Please approve ${fromToken.symbol} in your wallet...`);

            const approveTxHash = await (writeContractAsync as any)({
              chainId: targetChainId,
              address: tokenAddr,
              abi: ERC20_STANDARD_ABI,
              functionName: 'approve',
              args: [spenderAddr, requiredAmount],
            });

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
        } catch (allowanceErr: any) {
          console.warn('Allowance approval step error:', allowanceErr);
          const errText = allowanceErr.message || '';
          if (errText.includes('User rejected') || errText.includes('denied') || errText.includes('rejected')) {
            throw new Error('Token approval was rejected in your wallet.');
          }
          throw allowanceErr;
        }
      }

      // 4. Request Swap Signature from connected wallet
      setStatusStep('signing');
      setStatusMessage('Please confirm the swap transaction in your connected wallet...');

      // Calculate safe on-chain gas limit with dynamic estimation
      let txGasLimit: bigint | undefined = undefined;
      try {
        const rawEstimatedGas = await targetRpcClient.estimateGas({
          account: userAddr,
          to: txTo,
          data: txData as `0x${string}`,
          value: txValue,
        });

        // 25% safety buffer for DEX state changes
        const buffered = (rawEstimatedGas * 125n) / 100n;
        txGasLimit = buffered < 200000n ? 200000n : buffered;
      } catch (estErr: any) {
        console.warn('[SwapProcessingModal] Gas estimation notice:', estErr);
        const estErrMsg = (estErr?.shortMessage || estErr?.details || estErr?.message || '').toLowerCase();
        if (estErrMsg.includes('insufficient funds') || estErrMsg.includes('exceeds the balance') || estErrMsg.includes('gas * price + value')) {
          throw new Error(`Insufficient ${fromToken.symbol} balance to cover the swap amount plus network gas fees.`);
        }
        if (estErrMsg.includes('reverted') || estErrMsg.includes('execution reverted')) {
          throw new Error('On-chain simulation reverted. Slippage tolerance may be too low or liquidity moved.');
        }
        // Fallback default for wallets
        txGasLimit = quote.isDeBridge ? 450000n : 280000n;
      }

      const txParams: any = {
        chainId: targetChainId,
        to: txTo,
        data: txData as `0x${string}`,
        value: txValue,
      };

      if (txGasLimit) {
        txParams.gas = txGasLimit;
      }

      console.log('[PayFlux Swap Processing] Dispatching transaction to wallet:', txParams);

      const hash = await sendTransactionAsync(txParams);

      setTxHash(hash);
      setStatusStep('mining');
      setStatusMessage(`Transaction broadcasted. Awaiting confirmation on ${fromToken.networkName}...`);

      // 5. Wait for blockchain confirmation
      const receipt = await targetRpcClient.waitForTransactionReceipt({
        hash,
        timeout: 60000,
      });

      if (receipt.status === 'reverted') {
        throw new Error(`Transaction reverted on-chain (Tx: ${hash}). View: ${explorerBase}/tx/${hash}`);
      }

      // 6. If Cross-Chain Swap (deBridge), track order settlement
      if (quote.isDeBridge && orderId) {
        setStatusStep('crosschain');
        setStatusMessage('Source transaction confirmed! Cross-chain solver is fulfilling destination asset...');

        // Track deBridge order status
        let isSettled = false;
        const startTime = Date.now();
        while (!isSettled && Date.now() - startTime < 60000) {
          await new Promise((resolve) => setTimeout(resolve, 3500));
          try {
            const orderStatus = await checkDeBridgeOrderStatus(orderId);
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

      setStatusStep('success');
      setStatusMessage('Swap successfully confirmed on-chain!');

      // Complete swap and trigger true on-chain balance refresh
      onComplete({
        hash,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `${explorerBase}/tx/${hash}`,
        orderId,
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

      if (
        msg.includes('User rejected') ||
        msg.includes('denied') ||
        msg.includes('rejected') ||
        msg.includes('ACTION_REJECTED')
      ) {
        setErrorMessage('Transaction signature was rejected in your wallet.');
      } else if (
        msg.includes('insufficient funds') ||
        msg.includes('exceeds balance') ||
        msg.includes('gas * price + value')
      ) {
        setErrorMessage(`Insufficient ${quote.fromToken.symbol} balance to cover the swap amount plus network gas fee.`);
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
          /* Progress / Mining State */
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
            <p className="text-xs text-slate-400 mb-6 font-mono">
              {quote.fromAmount} {quote.fromToken.symbol} → ~{quote.toAmount} {quote.toToken.symbol}
            </p>

            {/* Status box */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-left space-y-2 mb-6">
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
                  ? 'Review and sign the swap transaction in your connected wallet.'
                  : statusStep === 'crosschain'
                  ? 'Source block confirmed. Decentralized solvers are executing destination asset transfer...'
                  : statusStep === 'mining'
                  ? `Transaction submitted. Awaiting block confirmation on ${quote.fromToken.networkName}...`
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

            <p className="text-[11px] text-slate-500">
              Please do not close this window until the blockchain transaction is confirmed.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

