import React, { useEffect, useState, useRef } from 'react';
import {
  Search,
  FileCode2,
  KeyRound,
  CheckCircle2,
  Loader2,
  Zap,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  XCircle,
  Globe
} from 'lucide-react';
import { SwapQuote, TransactionRecord } from '../types';
import { useWalletClient, usePublicClient, useAccount } from 'wagmi';
import { parseUnits, getAddress, createPublicClient, http, fallback } from 'viem';
import { polygon, mainnet } from 'viem/chains';

interface SwapProcessingModalProps {
  isOpen: boolean;
  quote: SwapQuote | null;
  onComplete: (txRecord: Partial<TransactionRecord>) => void;
  onClose: () => void;
}

const ERC20_APPROVE_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const SwapProcessingModal: React.FC<SwapProcessingModalProps> = ({
  isOpen,
  quote,
  onComplete,
  onClose,
}) => {
  const { data: walletClient } = useWalletClient();
  const wagmiPublicClient = usePublicClient();
  const { address } = useAccount();

  const [statusStep, setStatusStep] = useState<'validating' | 'approval' | 'signing' | 'broadcasting' | 'mining' | 'success' | 'error'>('validating');
  const [statusMessage, setStatusMessage] = useState<string>('Validating deBridge liquidity route...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const isExecutingRef = useRef(false);

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

    async function executeRealSwap() {
      try {
        setStatusStep('validating');
        setStatusMessage('Verifying cross-chain route and solver parameters...');

        // Check network requirement
        const fromToken = quote.fromToken;
        const targetChainId = fromToken.network === 'ethereum' ? mainnet.id : polygon.id;
        const targetChain = fromToken.network === 'ethereum' ? mainnet : polygon;

        const client = createPublicClient({
          chain: targetChain,
          transport: fromToken.network === 'ethereum'
            ? fallback([
                http('https://cloudflare-eth.com'),
                http('https://eth.llamarpc.com'),
                http('https://1rpc.io/eth'),
              ])
            : fallback([
                http('https://polygon-rpc.com'),
                http('https://polygon-bor-rpc.publicnode.com'),
                http('https://1rpc.io/matic'),
              ]),
        });

        // If we have a connected walletClient with a real transaction payload
        const activeTx = quote?.swapTx || quote?.deBridgeTx;
        if (!walletClient || !address) {
          throw new Error('Please connect your Web3 wallet before executing a swap transaction.');
        }

        if (!activeTx || !activeTx.data || !activeTx.to) {
          throw new Error('No executable route calldata found. Please refresh the quote and try again.');
        }

        const userAddr = getAddress(address);

        // 1. Check ERC-20 token allowance if not native POL or ETH
        const isNativeToken = !fromToken.contractAddress ||
          fromToken.contractAddress === '0x0000000000000000000000000000000000000000' ||
          fromToken.contractAddress === '0x0000000000000000000000000000000000001010' ||
          fromToken.contractAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

        if (!isNativeToken && fromToken.contractAddress) {
          const tokenAddr = getAddress(fromToken.contractAddress);
          const spenderAddr = getAddress(activeTx.allowanceTarget || activeTx.to);
          const requiredAmount = parseUnits(quote.fromAmount, fromToken.decimals);

          setStatusStep('validating');
          setStatusMessage(`Checking ${fromToken.symbol} token allowance on ${fromToken.networkName}...`);

          try {
            const currentAllowance = (await (client as any).readContract({
              address: tokenAddr,
              abi: ERC20_APPROVE_ABI,
              functionName: 'allowance',
              args: [userAddr, spenderAddr],
            })) as bigint;

            if (currentAllowance < requiredAmount) {
              setStatusStep('approval');
              setStatusMessage(`Please approve ${fromToken.symbol} in your wallet...`);

              const approveTxHash = await (walletClient as any).writeContract({
                address: tokenAddr,
                abi: ERC20_APPROVE_ABI,
                functionName: 'approve',
                args: [spenderAddr, requiredAmount],
              });

              setStatusStep('mining');
              setStatusMessage(`Confirming ${fromToken.symbol} approval on ${fromToken.networkName}...`);

              await (client as any).waitForTransactionReceipt({
                hash: approveTxHash,
              });
            }
          } catch (allowanceErr: any) {
            console.warn('Allowance check/approval notice:', allowanceErr);
            if (allowanceErr.message?.includes('User rejected') || allowanceErr.message?.includes('denied')) {
              throw new Error('Token approval was rejected in your wallet.');
            }
            throw allowanceErr;
          }
        }

        // 2. Request Swap Signature from connected wallet
        setStatusStep('signing');
        setStatusMessage('Please confirm the transaction in your connected wallet...');

        const hash = (await (walletClient as any).sendTransaction({
          to: getAddress(activeTx.to),
          data: activeTx.data as `0x${string}`,
          value: BigInt(activeTx.value || '0'),
        })) as `0x${string}`;

        setTxHash(hash);
        setStatusStep('mining');
        setStatusMessage(`Broadcasting transaction to ${fromToken.networkName} blockchain...`);

        // 3. Wait for blockchain confirmation
        const receipt = await (client as any).waitForTransactionReceipt({
          hash,
        });

        if (receipt.status === 'reverted') {
          const explorerBase = fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';
          throw new Error(`Transaction reverted on-chain (Tx: ${hash}). View on explorer: ${explorerBase}/tx/${hash}`);
        }

        setStatusStep('success');
        setStatusMessage('Swap successfully confirmed on-chain!');

        const explorerBase = fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';

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
        setErrorMessage(msg.includes('User rejected') ? 'Transaction signature was rejected in your wallet.' : msg);
      }
    }

    executeRealSwap();
  }, [isOpen, quote, walletClient, wagmiPublicClient, address, onComplete]);

  if (!isOpen || !quote) return null;

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
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs text-slate-200 transition-colors"
              >
                Close & Return
              </button>
            </div>
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
              {quote.isDeBridge ? 'Executing deBridge Cross-Chain Swap' : 'Processing Swap'}
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
                  ? 'Review the gas fees and sign the transaction prompt in your wallet.'
                  : statusStep === 'mining'
                  ? `Transaction has been submitted. Awaiting block confirmation on ${quote.fromToken.networkName || 'blockchain'}...`
                  : 'Validating smart contract route parameters and liquidity depth.'}
              </p>

              {txHash && (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Transaction</span>
                  <a
                    href={quote.fromToken.network === 'ethereum' ? `https://etherscan.io/tx/${txHash}` : `https://polygonscan.com/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline flex items-center gap-1 font-mono"
                  >
                    <span>View on {quote.fromToken.network === 'ethereum' ? 'Etherscan' : 'Polygonscan'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Tip footer */}
            <p className="text-[11px] text-slate-500">
              Please do not close the window until the blockchain transaction is confirmed.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
