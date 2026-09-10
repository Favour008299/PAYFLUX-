import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  ArrowLeft,
  Wallet,
  Send,
  Sparkles,
  QrCode,
  CheckCircle2,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { useAccount, useChainId, useSendTransaction, useWriteContract, useSwitchChain } from 'wagmi';
import { parseUnits, parseEther, formatUnits } from 'viem';
import confetti from 'canvas-confetti';

import { Token, WalletAccount, CustomerPaymentReceipt } from '../types';
import { TokenIcon } from './TokenIcon';
import { QRCodeDisplay } from './QRCodeDisplay';
import { shortenAddress, isValidEVMAddress } from '../utils/crypto';
import {
  TOKEN_CONTRACTS,
  ERC20_TRANSFER_ABI,
  getExplorerTxUrl,
} from '../services/contractConfig';
import { safeGetAddress } from '../services/sharedSwapEngine';
import { polygonRpcClient } from '../services/evmRpcClients';
import { saveTransaction } from '../services/historyStorage';

interface SharePayLinkCheckoutProps {
  tokens: Token[];
  wallet: WalletAccount | null;
  onOpenConnectModal: () => void;
  onPaymentSuccess?: (receipt: CustomerPaymentReceipt) => void;
  onResetToModeSelect: () => void;
}

export const SharePayLinkCheckout: React.FC<SharePayLinkCheckoutProps> = ({
  tokens,
  wallet,
  onOpenConnectModal,
  onPaymentSuccess,
  onResetToModeSelect,
}) => {
  const { address: wagmiAddress, isConnected: wagmiConnected, connector } = useAccount();
  const chainId = useChainId();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const activeAddress = (wagmiAddress || (wallet?.address as `0x${string}`)) || undefined;
  const isWalletConnected = Boolean((wagmiConnected || Boolean(wallet?.address)) && activeAddress);

  // Parse URL search parameters
  const [urlParams, setUrlParams] = useState<{
    token: string | null;
    to: string | null;
  }>(() => {
    if (typeof window === 'undefined') return { token: null, to: null };
    const params = new URLSearchParams(window.location.search);
    return {
      token: params.get('token'),
      to: params.get('to'),
    };
  });

  // Re-read on popstate or URL changes
  useEffect(() => {
    const handleUrlChange = () => {
      const params = new URLSearchParams(window.location.search);
      setUrlParams({
        token: params.get('token'),
        to: params.get('to'),
      });
    };
    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  const rawToken = urlParams.token?.trim() || '';
  const rawTo = urlParams.to?.trim() || '';

  // Validation logic
  const validation = useMemo(() => {
    // 1. Missing "to"
    if (!rawTo) {
      return {
        isValid: false,
        error: "Missing recipient wallet address. The payment link must include a 'to' parameter.",
        tokenObj: null,
      };
    }

    // 2. Invalid "to" EVM address
    if (!isValidEVMAddress(rawTo)) {
      return {
        isValid: false,
        error: `Invalid recipient address: "${rawTo}". Please provide a valid 42-character EVM address on Polygon.`,
        tokenObj: null,
      };
    }

    // 3. Missing "token"
    if (!rawToken) {
      return {
        isValid: false,
        error: "Missing payment token. The payment link must include a 'token' parameter (e.g. VERSE, POL, USDT).",
        tokenObj: null,
      };
    }

    // 4. Supported Polygon tokens
    const supportedSymbols = ['VERSE', 'POL', 'USDT', 'USDC', 'WBTC', 'WETH', 'DAI'];
    const matchedToken = tokens.find(
      (t) => t.network === 'polygon' && t.symbol.toUpperCase() === rawToken.toUpperCase()
    );

    if (!matchedToken || !supportedSymbols.includes(rawToken.toUpperCase())) {
      return {
        isValid: false,
        error: `Unsupported token "${rawToken}". PayFlux payments on Polygon support: VERSE, POL, USDT, and USDC.`,
        tokenObj: null,
      };
    }

    return {
      isValid: true,
      error: null,
      tokenObj: matchedToken,
    };
  }, [rawToken, rawTo, tokens]);

  const { isValid, error: validationError, tokenObj } = validation;

  // Payment state
  const defaultAmount = useMemo(() => {
    if (!rawToken) return '10';
    const sym = rawToken.toUpperCase();
    if (sym === 'VERSE') return '1000';
    if (sym === 'POL') return '5';
    if (sym === 'USDT' || sym === 'USDC') return '10';
    return '10';
  }, [rawToken]);

  const [paymentAmount, setPaymentAmount] = useState<string>(defaultAmount);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [showMobileQR, setShowMobileQR] = useState(false);

  // Execution state: 'idle' | 'submitting' | 'confirming' | 'completed' | 'failed'
  const [status, setStatus] = useState<'idle' | 'submitting' | 'confirming' | 'completed' | 'failed'>('idle');
  const [txHash, setTxHash] = useState<string>('');
  const [executionError, setExecutionError] = useState<string | null>(null);

  // User's on-chain balance for requested token
  const [userTokenBalance, setUserTokenBalance] = useState<number>(0);
  const [isLoadingBalance, setIsLoadingBalance] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchBalance() {
      if (!isWalletConnected || !activeAddress || !tokenObj) {
        setUserTokenBalance(0);
        return;
      }
      setIsLoadingBalance(true);
      try {
        if (tokenObj.isNative || tokenObj.symbol === 'POL') {
          const balWei = await polygonRpcClient.getBalance({ address: safeGetAddress(activeAddress) });
          if (!cancelled) {
            setUserTokenBalance(parseFloat(formatUnits(balWei, 18)));
          }
        } else {
          const contractAddr = tokenObj.contractAddress || (TOKEN_CONTRACTS[137] as any)?.[tokenObj.symbol]?.address;
          if (contractAddr) {
            const rawBal = (await (polygonRpcClient as any).readContract({
              address: safeGetAddress(contractAddr),
              abi: ERC20_TRANSFER_ABI,
              functionName: 'balanceOf',
              args: [safeGetAddress(activeAddress)],
            })) as bigint;
            if (!cancelled) {
              setUserTokenBalance(parseFloat(formatUnits(rawBal, tokenObj.decimals)));
            }
          }
        }
      } catch (err) {
        console.warn('[SharePayLinkCheckout] Balance fetch warning:', err);
      } finally {
        if (!cancelled) setIsLoadingBalance(false);
      }
    }

    fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [isWalletConnected, activeAddress, tokenObj, status]);

  // Copy address helper
  const handleCopyAddress = () => {
    if (!rawTo) return;
    navigator.clipboard.writeText(rawTo);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  // Switch network if needed
  const handleSwitchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: 137 });
    } catch (err: any) {
      setExecutionError(err?.message || 'Failed to switch network to Polygon');
    }
  };

  // Execute real on-chain payment
  const handleExecutePayment = async () => {
    if (!tokenObj || !rawTo || !isWalletConnected || !activeAddress) return;

    const numAmount = parseFloat(paymentAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setExecutionError('Please enter a valid payment amount greater than 0.');
      return;
    }

    if (chainId !== 137) {
      setExecutionError('Please switch your wallet network to Polygon (Chain ID 137) to continue.');
      return;
    }

    setExecutionError(null);
    setStatus('submitting');

    try {
      const formattedRecipient = safeGetAddress(rawTo);
      let submittedHash: string = '';

      if (tokenObj.isNative || tokenObj.symbol === 'POL') {
        // Native POL payment
        const valueWei = parseEther(numAmount.toString());
        submittedHash = await sendTransactionAsync({
          to: formattedRecipient,
          value: valueWei,
        });
      } else {
        // ERC20 payment (VERSE, USDT, USDC, etc.)
        const contractAddr = tokenObj.contractAddress || (TOKEN_CONTRACTS[137] as any)?.[tokenObj.symbol]?.address;
        if (!contractAddr) {
          throw new Error(`Token contract for ${tokenObj.symbol} not found on Polygon.`);
        }
        const parsedAmount = parseUnits(numAmount.toFixed(tokenObj.decimals > 6 ? 6 : tokenObj.decimals), tokenObj.decimals);

        submittedHash = await writeContractAsync({
          address: safeGetAddress(contractAddr),
          abi: ERC20_TRANSFER_ABI,
          functionName: 'transfer',
          args: [formattedRecipient, parsedAmount],
        } as any);
      }

      if (!submittedHash) {
        throw new Error('Transaction was not broadcast by wallet.');
      }

      setTxHash(submittedHash);
      setStatus('confirming');

      // Wait for real on-chain confirmation via Polygon RPC
      const receipt = await polygonRpcClient.waitForTransactionReceipt({
        hash: submittedHash as `0x${string}`,
        timeout: 60000,
      });

      if (receipt.status === 'success' || (receipt as any).status === 1 || (receipt as any).status === '0x1') {
        setStatus('completed');
        try {
          confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
        } catch (_) {}

        // Save to transaction history
        saveTransaction({
          id: `paylink_${Date.now()}`,
          hash: submittedHash,
          type: 'payment',
          tokenSymbol: tokenObj.symbol,
          amount: numAmount.toFixed(4),
          merchantName: 'PayFlux Pay Link',
          productName: `Direct ${tokenObj.symbol} Payment`,
          recipientAddress: formattedRecipient,
          senderAddress: activeAddress,
          timestamp: Date.now(),
          status: 'completed',
          network: 'polygon',
          networkFeeUsd: 0.005,
          blockNumber: Number(receipt.blockNumber || 0),
          explorerUrl: getExplorerTxUrl('polygon', submittedHash),
        });

        if (onPaymentSuccess) {
          onPaymentSuccess({
            id: `paylink_${Date.now()}`,
            merchantName: 'PayFlux Pay Link',
            merchantAddress: formattedRecipient,
            productName: `Direct ${tokenObj.symbol} Payment`,
            payerAddress: activeAddress,
            amountPaid: numAmount.toFixed(4),
            tokenSymbol: tokenObj.symbol,
            merchantReceivedAmount: numAmount.toFixed(4),
            merchantReceivedAsset: tokenObj.symbol,
            routingProtocol: 'Direct Polygon Transfer',
            isConverted: false,
            network: 'polygon',
            txHash: submittedHash,
            timestamp: Date.now(),
            fiatValueUsd: tokenObj.priceUsd ? numAmount * tokenObj.priceUsd : 0,
            chainId: 137,
            status: 'completed',
            networkFeeUsd: 0.01,
            explorerUrl: getExplorerTxUrl('polygon', submittedHash),
          });
        }
      } else {
        throw new Error('Transaction reverted on Polygon. Please check your gas and balance.');
      }
    } catch (err: any) {
      console.error('[SharePayLinkCheckout] Execution error:', err);
      const userMsg = err?.shortMessage || err?.message || 'Payment execution failed. Please try again.';
      setExecutionError(userMsg);
      setStatus('failed');
    }
  };

  // -------------------------------------------------------------
  // ERROR VIEW: When URL has missing token, missing to, or invalid params
  // -------------------------------------------------------------
  if (!isValid) {
    return (
      <div className="max-w-xl mx-auto py-6 px-4 space-y-6">
        {/* PayFlux Branding */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="text-white font-black text-base tracking-tighter">PF</span>
            </div>
            <div>
              <h1 className="text-base font-black text-white tracking-wide">PAYFLUX</h1>
              <p className="text-[10px] text-slate-400 font-medium">Non-Custodial Web3 Payment</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
            Polygon Network
          </span>
        </div>

        {/* Clear PayFlux Error Card */}
        <div className="bg-slate-900 border border-red-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-black text-white">Invalid Payment Link</h2>
            <p className="text-sm text-red-300/90 max-w-md mx-auto leading-relaxed">
              {validationError}
            </p>
          </div>

          {/* Details parsed from URL */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 text-left space-y-2.5 text-xs font-mono">
            <div className="flex justify-between items-center text-slate-400">
              <span>Requested Token:</span>
              <span className="font-bold text-slate-200">{rawToken || '<missing>'}</span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Recipient Address:</span>
              <span className="font-bold text-slate-200">
                {rawTo ? shortenAddress(rawTo, 6) : '<missing>'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Network:</span>
              <span className="text-purple-400 font-bold">Polygon (Chain ID 137)</span>
            </div>
          </div>

          {/* Action button to recover */}
          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button
              onClick={onResetToModeSelect}
              className="flex-1 py-3.5 px-4 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Open PayFlux Pay Hub</span>
            </button>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') window.location.href = '/';
              }}
              className="py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-all border border-slate-700"
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUCCESS VIEW: When payment transaction confirmed on-chain
  // -------------------------------------------------------------
  if (status === 'completed') {
    return (
      <div className="max-w-xl mx-auto py-6 px-4 space-y-6">
        <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-black text-white">Payment Confirmed!</h2>
            <p className="text-xs text-slate-400">
              Your transaction has been confirmed on the Polygon blockchain.
            </p>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-3 text-left text-xs">
            <div className="flex justify-between items-center text-slate-400">
              <span>Amount Sent:</span>
              <span className="font-extrabold text-white text-sm">
                {paymentAmount} {tokenObj?.symbol}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Recipient:</span>
              <span className="font-mono text-slate-200">{shortenAddress(rawTo, 6)}</span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Network:</span>
              <span className="font-bold text-purple-400">Polygon (137)</span>
            </div>
            {txHash && (
              <div className="flex justify-between items-center text-slate-400 pt-2 border-t border-slate-800">
                <span>Transaction Hash:</span>
                <a
                  href={getExplorerTxUrl('polygon', txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-bold"
                >
                  <span>{shortenAddress(txHash, 6)}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <a
              href={getExplorerTxUrl('polygon', txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-all border border-slate-700 flex items-center justify-center gap-2"
            >
              <span>View on PolygonScan</span>
              <ExternalLink className="w-4 h-4 text-slate-400" />
            </a>
            <button
              onClick={onResetToModeSelect}
              className="flex-1 py-3.5 px-4 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-sm transition-all shadow-lg shadow-cyan-500/20"
            >
              Done / Return to Pay
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // PRIMARY VIEW: Real PayFlux Payment Page for /pay?token=...&to=...
  // -------------------------------------------------------------
  const isInsufficient = isWalletConnected && userTokenBalance < parseFloat(paymentAmount || '0');
  const usdValue = tokenObj?.priceUsd && tokenObj.priceUsd > 0
    ? (parseFloat(paymentAmount || '0') * tokenObj.priceUsd).toFixed(2)
    : null;

  return (
    <div className="max-w-xl mx-auto py-4 px-4 space-y-5">
      {/* 1. PayFlux Branding Header */}
      <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="text-white font-black text-lg tracking-tighter">PF</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-white tracking-wide">PAYFLUX</h1>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                Payment Request
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Non-Custodial Web3 Payment</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
          <span>Polygon Network</span>
        </div>
      </div>

      {/* 2. Main Payment Card */}
      <div className="bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 hover:border-slate-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-6 transition-all">
        {/* Appropriate Explanatory Message */}
        <div className="p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-cyan-200">Payment to PayFlux Wallet</div>
            <p className="text-[11px] text-cyan-300/80 leading-relaxed">
              This payment link was created with PayFlux. When you send funds, they are deposited directly and non-custodially into the recipient's PayFlux Polygon wallet.
            </p>
          </div>
        </div>

        {/* Recipient Wallet Details */}
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Recipient Wallet Address</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              Polygon (137)
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="font-mono text-xs sm:text-sm text-white font-semibold break-all select-all">
              {rawTo}
            </span>
            <button
              onClick={handleCopyAddress}
              title="Copy Address"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0 flex items-center gap-1 text-[11px] font-bold"
            >
              {copiedAddress ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
            <span>Recipient: PayFlux User Wallet</span>
            <a
              href={`https://polygonscan.com/address/${rawTo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400/80 hover:text-cyan-300 flex items-center gap-1"
            >
              <span>View on PolygonScan</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Requested Token & Amount */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <label className="font-bold text-slate-300">Requested Payment Asset</label>
            <span className="text-slate-400 text-[11px]">
              {tokenObj?.priceUsd && tokenObj.priceUsd > 0
                ? `1 ${tokenObj.symbol} ≈ $${tokenObj.priceUsd < 0.01 ? tokenObj.priceUsd.toFixed(5) : tokenObj.priceUsd.toFixed(2)}`
                : 'Polygon Token'}
            </span>
          </div>

          {/* Token Display Row */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {tokenObj && <TokenIcon token={tokenObj} size="md" />}
              <div>
                <div className="text-sm font-black text-white flex items-center gap-2">
                  <span>{tokenObj?.symbol}</span>
                  <span className="text-[10px] font-normal text-slate-400 font-mono">({tokenObj?.name})</span>
                </div>
                <div className="text-[11px] text-purple-400 font-medium">Polygon Network</div>
              </div>
            </div>
            <div className="text-right">
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                Target Token
              </span>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between items-center text-xs">
              <label className="text-slate-400 font-medium">Payment Amount ({tokenObj?.symbol})</label>
              {usdValue && <span className="text-slate-400 text-[11px]">≈ ${usdValue} USD</span>}
            </div>
            <div className="relative">
              <input
                type="number"
                min="0.0001"
                step="any"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.0"
                className="w-full pl-3.5 pr-20 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-white font-mono text-base font-bold focus:border-cyan-500 focus:outline-none transition-colors"
              />
              <div className="absolute right-3.5 top-3 text-xs text-slate-300 font-black flex items-center gap-1">
                <span>{tokenObj?.symbol}</span>
              </div>
            </div>

            {/* Quick preset chips */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-slate-500">Presets:</span>
              {(tokenObj?.symbol === 'VERSE' ? ['500', '1000', '5000', '10000'] : ['5', '10', '25', '50']).map(
                (preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPaymentAmount(preset)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                      paymentAmount === preset
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700'
                    }`}
                  >
                    {preset}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        {/* Payer Wallet Balance Notice (if connected) */}
        {isWalletConnected && (
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-400">
              <Wallet className="w-4 h-4 text-purple-400" />
              <span>Your {tokenObj?.symbol} Balance:</span>
            </div>
            <div className="font-mono font-bold text-white">
              {isLoadingBalance ? (
                <span className="text-slate-500">Updating...</span>
              ) : (
                <span>
                  {userTokenBalance.toFixed(4)} {tokenObj?.symbol}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error notification if execution failed */}
        {executionError && (
          <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold">Transaction Notice</div>
              <p className="text-[11px] leading-relaxed text-red-200/90">{executionError}</p>
            </div>
          </div>
        )}

        {/* 3. Action Button: Connect Wallet or Pay */}
        <div className="space-y-3 pt-2">
          {!isWalletConnected ? (
            <button
              id="share-pay-link-connect-btn"
              type="button"
              onClick={onOpenConnectModal}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-cyan-500 via-cyan-400 to-purple-500 hover:from-cyan-400 hover:to-purple-400 text-slate-950 font-black text-sm transition-all shadow-xl shadow-cyan-500/25 flex items-center justify-center gap-2"
            >
              <Wallet className="w-4 h-4" />
              <span>Connect Wallet to Pay</span>
            </button>
          ) : chainId !== 137 ? (
            <button
              id="share-pay-link-switch-chain-btn"
              type="button"
              onClick={handleSwitchNetwork}
              className="w-full py-4 px-6 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-black text-sm transition-all shadow-xl shadow-purple-600/25 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Switch Network to Polygon</span>
            </button>
          ) : isInsufficient ? (
            <div className="space-y-2">
              <button
                type="button"
                disabled
                className="w-full py-4 px-6 rounded-2xl bg-slate-800 text-slate-500 font-black text-sm cursor-not-allowed border border-slate-700 flex items-center justify-center gap-2"
              >
                <span>Insufficient {tokenObj?.symbol} Balance</span>
              </button>
              <p className="text-[11px] text-center text-amber-400/90">
                You have {userTokenBalance.toFixed(4)} {tokenObj?.symbol}. Please reduce the amount or swap tokens first.
              </p>
            </div>
          ) : (
            <button
              id="share-pay-link-execute-btn"
              type="button"
              onClick={handleExecutePayment}
              disabled={status === 'submitting' || status === 'confirming'}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-black text-sm transition-all shadow-xl shadow-cyan-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'submitting' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Confirm in Your Wallet...</span>
                </>
              ) : status === 'confirming' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Confirming On-Chain on Polygon...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 text-slate-950" />
                  <span>
                    Pay {paymentAmount} {tokenObj?.symbol} to {shortenAddress(rawTo, 4)}
                  </span>
                </>
              )}
            </button>
          )}

          {/* Toggle Mobile QR Code */}
          <div className="pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => setShowMobileQR((prev) => !prev)}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-950/70 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-bold transition-colors flex items-center justify-center gap-2"
            >
              <QrCode className="w-3.5 h-3.5 text-cyan-400" />
              <span>{showMobileQR ? 'Hide Mobile Wallet QR' : 'Pay via Mobile Wallet QR Code'}</span>
            </button>

            {showMobileQR && (
              <div className="mt-3 p-5 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-3">
                <div className="text-xs font-bold text-white">Scan with Mobile Wallet</div>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                  Scan this QR code using Bitcoin.com Wallet, MetaMask, or any Polygon-compatible mobile wallet to send {tokenObj?.symbol}.
                </p>
                <div className="flex justify-center p-3 bg-white rounded-2xl w-fit mx-auto shadow-lg">
                  <QRCodeDisplay value={`ethereum:${rawTo}`} size={160} />
                </div>
                <div className="text-[10px] text-slate-500 font-mono break-all">{rawTo}</div>
              </div>
            )}
          </div>
        </div>

        {/* Secondary Back Navigation */}
        <div className="pt-1 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={onResetToModeSelect}
            className="text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Open Merchant Pay & QR Scanner</span>
          </button>
          <span className="text-[10px] text-slate-500">PayFlux Non-Custodial</span>
        </div>
      </div>
    </div>
  );
};
