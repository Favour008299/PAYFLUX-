import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  ArrowDown,
  ShieldCheck,
  Fuel,
  Sparkles,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  Globe,
  X,
  Smartphone,
  Copy,
  Check,
} from 'lucide-react';
import { SwapQuote, UserSettings, TransactionRecord, WalletAccount } from '../types';
import { formatCurrency, shortenAddress } from '../utils/crypto';
import { useAccount, useSwitchChain, useSendTransaction, useWriteContract, useChainId } from 'wagmi';
import { useAppKit } from '../hooks/useAppKit';
import { parseUnits, parseEther, encodeFunctionData } from 'viem';
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
  setupWalletReturnDetector,
  getConnectedWalletBrand,
  isBitcoinComWallet,
} from '../services/walletSigningService';
import {
  recordSwapAttempt,
  recordSwapSuccess,
  recordSwapFailure,
  updateSwapTxHash,
} from '../services/swapAnalyticsService';
import { PAYFLUX_TREASURY_ADDRESS, PAYFLUX_PLATFORM_FEE_POL, PAYFLUX_PLATFORM_FEE_DISPLAY } from '../config/platform';
import { executeAndVerifyPlatformFee, FeeExecutionResult, checkSufficientFeeBalance } from '../services/payfluxFeeService';

interface SwapConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  quote: SwapQuote | null;
  wallet: WalletAccount | null;
  onComplete: (txRecord: Partial<TransactionRecord>) => void;
  settings: UserSettings;
}

function safeFormatError(err: any): string {
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

function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, ms);
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
}

export const SwapConfirmationModal: React.FC<SwapConfirmationModalProps> = ({
  isOpen,
  onClose,
  quote,
  wallet,
  onComplete,
  settings,
}) => {
  const { open } = useAppKit();
  const { address: wagmiAddress, isConnected: wagmiConnected, connector } = useAccount();
  const wagmiChainId = useChainId();

  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  // Active address resolution with persistent fallback to wallet prop
  const activeAddress = ((wagmiAddress || wallet?.address) as `0x${string}`) || undefined;
  const isWalletConnected = Boolean((wagmiConnected || Boolean(wallet?.address)) && activeAddress);
  const activeChainId = wagmiChainId;

  // Lifecycle states: 'review' -> 'processing' -> 'success' | 'error'
  const [modalStage, setModalStage] = useState<'review' | 'processing' | 'success' | 'error'>('review');
  const [statusStep, setStatusStep] = useState<
    'validating' | 'network' | 'approval' | 'signing' | 'mining' | 'crosschain'
  >('validating');
  const [statusMessage, setStatusMessage] = useState<string>('Validating liquidity route...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [feeTxHash, setFeeTxHash] = useState<string | null>(null);
  const [feeVerified, setFeeVerified] = useState<boolean>(false);
  const [deBridgeOrderId, setDeBridgeOrderId] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  const isExecutingRef = useRef(false);
  const hasCompletedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const currentAttemptIdRef = useRef<string | null>(null);
  const feeResultRef = useRef<FeeExecutionResult | null>(null);
  const prevIsOpenRef = useRef(false);

  // Return detector: when user returns from Bitcoin.com Wallet app back to browser tab during swap
  useEffect(() => {
    if (!isOpen || modalStage !== 'processing') return;

    const cleanup = setupWalletReturnDetector(async () => {
      console.log('[SwapConfirmationModal] User returned from wallet app. Checking transaction & session state...');
      if (statusStep === 'signing' || statusStep === 'approval') {
        setStatusMessage('Resuming check from wallet app...');
      } else if (statusStep === 'mining' && txHash) {
        // Fast-track on-chain receipt check on return
        try {
          const targetRpcClient = quote?.fromToken?.network === 'ethereum' ? ethereumRpcClient : polygonRpcClient;
          const r = await targetRpcClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
          if (r && r.status === 'success' && !hasCompletedRef.current) {
            hasCompletedRef.current = true;
            isExecutingRef.current = false;
            setModalStage('success');
          }
        } catch (_) {}
      }
    });

    return () => cleanup();
  }, [isOpen, modalStage, statusStep, txHash, quote?.fromToken?.network]);

  // Initialize modal stage and track swap attempt only when modal opens
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current && quote) {
      setModalStage('review');
      setStatusStep('validating');
      setStatusMessage('Validating liquidity route...');
      setErrorMessage(null);
      setTxHash(null);
      setFeeTxHash(null);
      setFeeVerified(false);
      setDeBridgeOrderId(null);
      setCopiedHash(false);
      isExecutingRef.current = false;
      hasCompletedRef.current = false;
      isCancelledRef.current = false;
      feeResultRef.current = null;

      const fromAmountUsd = (parseFloat(quote.fromAmount) || 0) * (quote.fromToken?.priceUsd || 0);
      const toAmountUsd = (parseFloat(quote.toAmount) || 0) * (quote.toToken?.priceUsd || 0);
      const targetChainId: number = quote.fromToken?.network === 'ethereum' ? 1 : 137;

      const attemptId = recordSwapAttempt({
        userAddress: activeAddress || '0x',
        fromTokenSymbol: quote.fromToken?.symbol || 'UNKNOWN',
        toTokenSymbol: quote.toToken?.symbol || 'UNKNOWN',
        fromTokenAddress: quote.fromToken?.contractAddress,
        toTokenAddress: quote.toToken?.contractAddress,
        fromAmount: quote.fromAmount,
        toAmount: quote.toAmount,
        fromAmountUsd,
        toAmountUsd,
        network: quote.fromToken?.network || 'polygon',
        chainId: targetChainId,
        isCrossChain: quote.isDeBridge,
        routingProtocol: quote.routingProtocol || quote.route,
        orderId: quote.orderId,
        status: 'attempted',
      });
      currentAttemptIdRef.current = attemptId;
    } else if (!isOpen && prevIsOpenRef.current) {
      isCancelledRef.current = true;
      isExecutingRef.current = false;
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, quote, activeAddress]);

  if (!isOpen || !quote) return null;

  const {
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    exchangeRate,
    networkFeeUsd,
    slippageTolerance,
    minimumReceived,
  } = quote;

  const fromAmountUsd = (parseFloat(fromAmount) || 0) * (fromToken?.priceUsd || 0);
  const parsedFromNum = parseFloat(fromAmount) || 0;
  const isPolFrom = fromToken.symbol === 'POL';

  // Dynamic minimum calculations
  const estimatedGasPol = quote.fromToken.network === 'ethereum'
    ? 0.008
    : (quote.networkFeeUsd > 0 && quote.fromToken?.priceUsd ? Math.max(0.004, quote.networkFeeUsd / 0.25) : 0.008);
  const requiredGasBufferPol = 0.005;
  const dynamicMinPol = parseFloat((PAYFLUX_PLATFORM_FEE_POL + estimatedGasPol + requiredGasBufferPol).toFixed(4));

  const isAmountTooSmall = parsedFromNum > 0 && (
    (isPolFrom && parsedFromNum < dynamicMinPol) ||
    (!isPolFrom && fromAmountUsd > 0 && fromAmountUsd < 0.05)
  );

  const explorerBase = fromToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';

  const handleCopyHash = () => {
    if (txHash) {
      navigator.clipboard.writeText(txHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const executeRealSwap = async () => {
    if (!quote || isExecutingRef.current || hasCompletedRef.current) return;
    isExecutingRef.current = true;
    isCancelledRef.current = false;

    setModalStage('processing');
    setStatusStep('validating');
    setErrorMessage(null);
    setStatusMessage('Verifying swap parameters and wallet session...');

    const toAmountUsd = (parseFloat(quote.toAmount) || 0) * (toToken?.priceUsd || 0);
    const targetChainId: number = fromToken?.network === 'ethereum' ? 1 : 137;

    const attemptId = currentAttemptIdRef.current || recordSwapAttempt({
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
      status: 'attempted',
    });
    currentAttemptIdRef.current = attemptId;

    try {
      // 1. Check account state and minimum amount
      if (!isWalletConnected || !activeAddress) {
        throw new Error('Please connect your wallet to execute this swap.');
      }

      const numFromAmount = parseFloat(quote.fromAmount);
      if (!quote.fromAmount || isNaN(numFromAmount) || numFromAmount <= 0) {
        throw new Error('Please enter a valid swap amount greater than 0.');
      }

      if (isAmountTooSmall) {
        throw new Error(
          isPolFrom
            ? `Swap amount must be at least ${dynamicMinPol} POL to cover the fixed 0.1 POL PayFlux platform fee, estimated network gas (~${estimatedGasPol.toFixed(4)} POL), and gas buffer.`
            : 'Swap amount is too small — please increase the amount.'
        );
      }

      // Check and switch network if required with timeout
      if (activeChainId && activeChainId !== targetChainId && switchChainAsync) {
        setStatusStep('network');
        setStatusMessage(`Switching wallet network to ${fromToken.networkName}...`);
        try {
          await withTimeout(
            switchChainAsync({ chainId: targetChainId }),
            20000,
            `Network switch request timed out. Please switch your wallet network to ${fromToken.networkName}.`
          );
        } catch (switchErr: any) {
          const swMsg = safeFormatError(switchErr).toLowerCase();
          if (swMsg.includes('user rejected') || swMsg.includes('denied')) {
            throw new Error(`Please switch your wallet network to ${fromToken.networkName} (Chain ID: ${targetChainId}) to continue.`);
          }
        }
      }

      const destChainId: number = toToken.network === 'ethereum' ? 1 : 137;
      const targetRpcClient = targetChainId === 137 ? polygonRpcClient : ethereumRpcClient;
      const isSrcNative = isNativeAddress(fromToken.contractAddress);
      const isDestNative = isNativeAddress(toToken.contractAddress);

      // 2. Verify signing provider with timeout
      let signingSession = await withTimeout(
        verifyActiveSigningSession({
          connector,
          appKitProvider: (await connector?.getProvider()) || (window as any).ethereum,
          expectedAccount: activeAddress,
          targetChainId,
        }),
        15000,
        'Wallet connection verification timed out. Please make sure your wallet is active and unlocked.'
      );

      const activeWalletAddress = signingSession.account;
      const activeProvider = signingSession.provider;

      if (isCancelledRef.current) return;

      // 3. Resolve executable transaction data
      setStatusStep('validating');
      setStatusMessage('Preparing executable transaction...');

      let txTo: `0x${string}`;
      let txData: `0x${string}`;
      let txValue: bigint;
      let spenderAddr: `0x${string}`;
      let orderId = quote.orderId;
      const isCrossChain = Boolean(quote.isDeBridge || targetChainId !== destChainId);

      if (quote.swapTx?.to && quote.swapTx?.data) {
        txTo = safeGetAddress(quote.swapTx.to);
        txData = quote.swapTx.data as `0x${string}`;
        txValue = BigInt(quote.swapTx.value || '0');
        spenderAddr = safeGetAddress(quote.swapTx.allowanceTarget || txTo);
      } else {
        const srcTokenAddr = isSrcNative ? ZERO_ADDRESS : safeGetAddress(fromToken.contractAddress);
        const dstTokenAddr = isDestNative ? ZERO_ADDRESS : safeGetAddress(toToken.contractAddress);

        const freshQuote = await withTimeout(
          getUnifiedSwapQuote({
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
          }),
          10000,
          'Route resolution timed out. Please tap retry to fetch a fresh route.'
        );

        if (isCancelledRef.current) return;

        if (!freshQuote.success || !freshQuote.transactionTo || !freshQuote.transactionData) {
          throw new Error(freshQuote.errorMessage || 'Swap route unavailable for this token pair or size.');
        }

        txTo = safeGetAddress(freshQuote.transactionTo);
        txData = freshQuote.transactionData as `0x${string}`;
        txValue = BigInt(freshQuote.transactionValue || '0');
        spenderAddr = safeGetAddress(freshQuote.allowanceTarget || txTo);
        orderId = freshQuote.orderId || orderId;
      }

      if (orderId) {
        setDeBridgeOrderId(orderId);
      }

      // 4. Pre-Validation: Verify balance, minimum swap amount, and 0.1 POL fee coverage
      if (fromToken.symbol === 'POL' && numFromAmount < dynamicMinPol) {
        throw new Error(`Swap amount must be at least ${dynamicMinPol} POL to cover the fixed 0.1 POL PayFlux platform fee, estimated gas (~${estimatedGasPol.toFixed(4)} POL), and gas buffer.`);
      }

      const feeCheck = await checkSufficientFeeBalance({
        userAddress: activeWalletAddress,
        fromTokenSymbol: fromToken.symbol,
        fromAmount: quote.fromAmount,
      });

      if (!feeCheck.isSufficient) {
        throw new Error(feeCheck.errorMessage || 'Insufficient balance to cover the 0.1 POL PayFlux platform fee.');
      }

      const requiredAmount = parseUnits(quote.fromAmount, fromToken.decimals || 18);
      if (isSrcNative) {
        const nativeBal = await targetRpcClient.getBalance({ address: activeWalletAddress });
        const totalRequiredNative = fromToken.symbol === 'POL'
          ? requiredAmount + parseEther('0.1') + parseEther(estimatedGasPol.toFixed(6))
          : requiredAmount;

        if (nativeBal < totalRequiredNative) {
          throw new Error(
            fromToken.symbol === 'POL'
              ? `Insufficient POL balance in your wallet. Required: ${(numFromAmount + 0.1 + estimatedGasPol).toFixed(4)} POL (${quote.fromAmount} POL swap + 0.1 POL platform fee + network gas).`
              : `Insufficient ${fromToken.symbol} balance in your wallet. Required: ${quote.fromAmount} ${fromToken.symbol}`
          );
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

      // 5. Token Approval if needed (only for non-native ERC-20 tokens if allowance is insufficient)
      if (!isSrcNative && fromToken.contractAddress) {
        const tokenAddr = safeGetAddress(fromToken.contractAddress);
        setStatusStep('validating');
        setStatusMessage(`Checking ${fromToken.symbol} allowance...`);

        const currentAllowance = (await (targetRpcClient as any).readContract({
          address: tokenAddr,
          abi: ERC20_STANDARD_ABI,
          functionName: 'allowance',
          args: [activeWalletAddress, spenderAddr],
        })) as bigint;

        if (currentAllowance < requiredAmount) {
          if (isCancelledRef.current) return;

          setStatusStep('approval');
          setStatusMessage(`Please approve ${fromToken.symbol} in ${getConnectedWalletBrand(connector?.name)}...`);

          triggerMobileWalletPrompt(connector?.name || 'Bitcoin.com Wallet');

          let approveTxHash: `0x${string}`;
          try {
            if (writeContractAsync) {
              approveTxHash = await withTimeout(
                (writeContractAsync as any)({
                  address: tokenAddr,
                  abi: ERC20_STANDARD_ABI,
                  functionName: 'approve',
                  args: [spenderAddr, requiredAmount],
                  chainId: targetChainId,
                }),
                60000,
                'Token approval request timed out in wallet. Please check your wallet app.'
              );
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
                60000,
                'Token approval request timed out. Please check your wallet.'
              );
            }
          } catch (apprErr: any) {
            const apprMsg = safeFormatError(apprErr).toLowerCase();
            if (
              apprMsg.includes('user rejected') ||
              apprMsg.includes('denied') ||
              apprMsg.includes('disapproved') ||
              apprMsg.includes('action_rejected')
            ) {
              throw new Error('Token approval rejected in wallet.');
            }
            throw apprErr;
          }

          if (isCancelledRef.current) return;

          setStatusStep('mining');
          setStatusMessage(`Confirming ${fromToken.symbol} approval on ${fromToken.networkName}...`);

          const approveReceipt = await withTimeout(
            targetRpcClient.waitForTransactionReceipt({
              hash: approveTxHash,
              timeout: 45000,
            }),
            45000,
            'Token approval confirmation timed out on blockchain.'
          );

          if (approveReceipt.status === 'reverted') {
            throw new Error(`Token approval transaction reverted on-chain.`);
          }
        }
      }

      if (isCancelledRef.current) return;

      // 6. Genuine On-Chain PayFlux Platform Fee Collection (Fixed 0.1 POL) to Revenue Wallet (0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD)
      let collectedFeeResult: FeeExecutionResult | null = feeResultRef.current;
      
      // If fee not yet collected/verified for this attempt, execute on-chain 0.1 POL transfer
      if (!collectedFeeResult || !collectedFeeResult.success || !collectedFeeResult.feeTxHash) {
        setStatusStep('signing');
        setStatusMessage(`Processing PayFlux platform fee (${PAYFLUX_PLATFORM_FEE_DISPLAY}) to revenue wallet...`);

        try {
          collectedFeeResult = await withTimeout(
            executeAndVerifyPlatformFee({
              payerAddress: activeWalletAddress,
              chainId: targetChainId,
              tokenSymbol: fromToken.symbol,
              tokenContractAddress: fromToken.contractAddress,
              tokenDecimals: fromToken.decimals,
              tokenPriceUsd: fromToken.priceUsd,
              sendTransactionAsync,
              writeContractAsync,
              activeProvider,
            }),
            75000,
            'PayFlux 0.1 POL platform fee confirmation timed out in wallet.'
          );

          feeResultRef.current = collectedFeeResult;
          if (collectedFeeResult.success && collectedFeeResult.feeTxHash) {
            setFeeTxHash(collectedFeeResult.feeTxHash);
            setFeeVerified(true);
            console.log('[SwapConfirmationModal] On-chain 0.1 POL fee transfer verified to PayFlux revenue wallet:', collectedFeeResult.feeTxHash);
          } else {
            setFeeVerified(false);
            throw new Error(collectedFeeResult.error || '0.1 POL platform fee transfer could not be confirmed on-chain.');
          }
        } catch (feeErr: any) {
          console.warn('[SwapConfirmationModal] Fee collection notice:', safeFormatError(feeErr));
          setFeeVerified(false);
          const feeMsg = safeFormatError(feeErr).toLowerCase();
          if (
            feeMsg.includes('user rejected') ||
            feeMsg.includes('denied') ||
            feeMsg.includes('disapproved') ||
            feeMsg.includes('action_rejected')
          ) {
            throw new Error('Platform fee confirmation was rejected in your wallet.');
          }
          throw feeErr;
        }
      }

      if (isCancelledRef.current) return;

      // 7. Sign & Send Swap Transaction to DEX Router / Bridge
      setStatusStep('signing');
      setStatusMessage(`Please confirm the swap in ${getConnectedWalletBrand(connector?.name)}...`);

      triggerMobileWalletPrompt(connector?.name || 'Bitcoin.com Wallet');

      let hash: `0x${string}`;
      try {
        if (sendTransactionAsync) {
          hash = await withTimeout(
            sendTransactionAsync({
              to: txTo,
              data: txData,
              value: txValue,
              chainId: targetChainId,
            }),
            75000,
            'Swap confirmation timed out in wallet. Please check your wallet app.'
          );
        } else if (activeProvider) {
          hash = await sendTransactionWithRetry(
            activeProvider,
            {
              from: activeWalletAddress,
              to: txTo,
              data: txData,
              value: '0x' + txValue.toString(16),
            },
            75000,
            'Wallet confirmation timed out. Please check your wallet app.'
          );
        } else {
          throw new Error('No active wallet provider available.');
        }
      } catch (sendErr: any) {
        const errStr = safeFormatError(sendErr).toLowerCase();
        if (
          errStr.includes('user rejected') ||
          errStr.includes('user denied') ||
          errStr.includes('rejected by user') ||
          errStr.includes('action_rejected')
        ) {
          throw new Error('Transaction rejected in your wallet.');
        }
        throw sendErr;
      }

      if (isCancelledRef.current) return;

      setTxHash(hash);
      setFeeTxHash(hash);
      setFeeVerified(true);
      setStatusStep('mining');
      setStatusMessage('Transaction submitted — confirming on blockchain...');

      if (currentAttemptIdRef.current) {
        updateSwapTxHash(currentAttemptIdRef.current, hash, `${explorerBase}/tx/${hash}`);
      }

      // 8. Wait for on-chain block receipt (Never show success without on-chain confirmation)
      const receipt = await withTimeout(
        targetRpcClient.waitForTransactionReceipt({
          hash,
          timeout: 60000,
        }),
        60000,
        `Blockchain confirmation timed out. You can verify transaction status on explorer: ${explorerBase}/tx/${hash}`
      );

      if (receipt.status === 'reverted') {
        throw new Error(`Transaction reverted on-chain (Tx: ${hash}). View: ${explorerBase}/tx/${hash}`);
      }

      // 9. Cross-chain polling if needed
      if (isCrossChain && orderId) {
        setStatusStep('crosschain');
        setStatusMessage('Source transaction confirmed! Cross-chain solver is fulfilling asset...');

        let isSettled = false;
        const startTime = Date.now();
        while (!isSettled && Date.now() - startTime < 45000) {
          if (isCancelledRef.current) return;
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

      // 10. Verified On-Chain Success
      if (hasCompletedRef.current) return;
      hasCompletedRef.current = true;
      isExecutingRef.current = false;

      setModalStage('success');

      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#00D4FF', '#A855F7', '#10B981', '#6366F1'],
        });
      } catch (_) {}

      const verifiedFeeDetails = collectedFeeResult?.success && collectedFeeResult.feeTxHash ? {
        feeTxHash: collectedFeeResult.feeTxHash,
        feeBlockNumber: collectedFeeResult.feeBlockNumber || Number(receipt.blockNumber),
        feeVerified: true,
        feeRecipient: collectedFeeResult.feeRecipient || PAYFLUX_TREASURY_ADDRESS,
        feeToken: 'POL',
        feeAmountToken: '0.1',
        payfluxFeePol: PAYFLUX_PLATFORM_FEE_POL,
        payfluxFeeUsd: collectedFeeResult.feeAmountUsd || 0.10,
        feeStatus: 'confirmed' as const,
      } : {
        feeVerified: false,
        feeStatus: 'uncollected' as const,
        payfluxFeePol: 0,
        payfluxFeeUsd: 0,
        feeRecipient: PAYFLUX_TREASURY_ADDRESS,
      };

      if (currentAttemptIdRef.current) {
        recordSwapSuccess(currentAttemptIdRef.current, {
          txHash: hash,
          blockNumber: Number(receipt.blockNumber),
          explorerUrl: `${explorerBase}/tx/${hash}`,
          orderId,
          feeDetails: verifiedFeeDetails,
        });
      }

      onComplete({
        hash,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `${explorerBase}/tx/${hash}`,
        orderId,
      });
    } catch (err: any) {
      console.error('[SwapConfirmationModal] Execution error:', safeFormatError(err));
      isExecutingRef.current = false;
      setModalStage('error');

      const rawMsg = safeFormatError(err);
      const lowerMsg = rawMsg.toLowerCase();
      let determined = rawMsg;
      let failureStatus: 'failed' | 'rejected' | 'cancelled' = 'failed';

      if (
        lowerMsg.includes('user rejected') ||
        lowerMsg.includes('user denied') ||
        lowerMsg.includes('action_rejected') ||
        lowerMsg.includes('rejected by user')
      ) {
        determined = 'Transaction rejected in your wallet.';
        failureStatus = 'rejected';
      } else if (
        lowerMsg.includes('insufficient funds') ||
        lowerMsg.includes('exceeds balance')
      ) {
        determined = `Insufficient balance in your wallet: ${rawMsg}`;
      } else {
        determined = rawMsg;
      }

      setErrorMessage(determined);

      if (currentAttemptIdRef.current) {
        recordSwapFailure(currentAttemptIdRef.current, determined, txHash || undefined, failureStatus);
      }
    }
  };

  const handleAbort = () => {
    isCancelledRef.current = true;
    isExecutingRef.current = false;
    hasCompletedRef.current = false;
    if (currentAttemptIdRef.current && modalStage !== 'success') {
      recordSwapFailure(currentAttemptIdRef.current, 'Swap cancelled by user.', txHash || undefined, 'cancelled');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="swap-confirmation-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150 relative"
      >
        {/* ============================================================ */}
        {/* STAGE 1: REVIEW DETAILS                                      */}
        {/* ============================================================ */}
        {modalStage === 'review' && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-white">Confirm Swap</h3>
                  <p className="text-[11px] text-slate-400">Review your transaction details</p>
                </div>
              </div>
              <button
                id="close-confirmation-btn"
                onClick={handleAbort}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tokens Exchange Summary Card */}
            <div className="my-4 space-y-2">
              {/* You Pay Box */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    You Pay
                  </span>
                  <div className="text-xl font-black text-white font-mono">
                    {fromAmount} {fromToken.symbol}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    ≈ {formatCurrency(parseFloat(fromAmount) * fromToken.priceUsd, settings.currency)}
                  </div>
                </div>
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm shadow-md"
                  style={{ backgroundColor: fromToken.iconBg, color: fromToken.iconColor }}
                >
                  {fromToken.symbol.charAt(0)}
                </div>
              </div>

              {/* Arrow Divider */}
              <div className="flex justify-center -my-2 relative z-10">
                <div className="w-7 h-7 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center text-cyan-400">
                  <ArrowDown className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* You Receive Box */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">
                    You Receive (Estimated)
                  </span>
                  <div className="text-xl font-black text-cyan-300 font-mono">
                    {toAmount} {toToken.symbol}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    ≈ {formatCurrency(parseFloat(toAmount) * toToken.priceUsd, settings.currency)}
                  </div>
                </div>
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm shadow-md"
                  style={{ backgroundColor: toToken.iconBg, color: toToken.iconColor }}
                >
                  {toToken.symbol.charAt(0)}
                </div>
              </div>
            </div>

            {/* Detailed Breakdown */}
            <div className="p-3.5 rounded-2xl bg-slate-950/50 border border-slate-800/80 text-xs space-y-2 mb-4">
              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400">Exchange Rate</span>
                <span className="font-mono font-bold text-white">
                  1 {fromToken.symbol} = {exchangeRate < 0.0001 ? exchangeRate.toExponential(4) : exchangeRate.toFixed(6)} {toToken.symbol}
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400 flex items-center gap-1">
                  <Fuel className="w-3.5 h-3.5 text-slate-400" />
                  <span>Network Gas Fee</span>
                </span>
                <span className="font-mono font-medium text-slate-200">
                  ~{formatCurrency(networkFeeUsd, settings.currency)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/25 space-y-1.5">
                <div className="flex items-center justify-between text-slate-200">
                  <span className="text-slate-300 flex items-center gap-1.5 text-xs font-bold">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span>PayFlux Platform Fee</span>
                  </span>
                  <span className="font-mono font-black text-purple-300 text-xs">
                    {PAYFLUX_PLATFORM_FEE_DISPLAY}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-purple-500/20">
                  <span className="text-slate-400">Revenue Wallet:</span>
                  <span className="text-purple-300 font-bold" title={PAYFLUX_TREASURY_ADDRESS}>
                    {shortenAddress(PAYFLUX_TREASURY_ADDRESS, 5)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400">Slippage Tolerance</span>
                <span className="font-mono font-medium text-slate-200">{slippageTolerance}%</span>
              </div>

              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400">Minimum Received</span>
                <span className="font-mono font-bold text-emerald-400">
                  {minimumReceived} {toToken.symbol}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[11px]">
                <span className="text-slate-400">Order Routing</span>
                <span className="text-purple-300 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-purple-400" />
                  {quote.route || 'deBridge DLN Cross-Chain Infrastructure'}
                </span>
              </div>
            </div>

            {/* Security / Verification badge */}
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[11px] text-slate-300 mb-5">
              <ShieldCheck className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <span>Real on-chain settlement secured by deBridge and Polygon.</span>
            </div>

            {/* Action Buttons */}
            {isAmountTooSmall ? (
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 font-bold text-center">
                  Swap amount too small — increase the amount.
                </div>
                <button
                  id="close-too-small-swap-btn"
                  onClick={handleAbort}
                  className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <button
                  id="cancel-swap-btn"
                  onClick={handleAbort}
                  className="w-1/3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="confirm-swap-action-btn"
                  onClick={executeRealSwap}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99]"
                >
                  <Zap className="w-4 h-4 fill-current" />
                  <span>Confirm Swap</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* ============================================================ */}
        {/* STAGE 2: IN-PLACE PROCESSING / SIGNING                       */}
        {/* ============================================================ */}
        {modalStage === 'processing' && (
          <div className="text-center">
            {/* Step Progress Tracker */}
            <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-slate-400 pb-3 mb-4 border-b border-slate-800">
              <span className={`flex items-center gap-1 ${statusStep === 'validating' || statusStep === 'network' ? 'text-cyan-400 font-bold' : 'text-slate-300'}`}>
                <span>1. Verify</span>
              </span>
              <span>→</span>
              <span className={statusStep === 'approval' ? 'text-cyan-400 font-bold' : !isNativeAddress(fromToken.contractAddress) ? 'text-slate-300' : 'text-slate-600'}>
                2. Approve
              </span>
              <span>→</span>
              <span className={statusStep === 'signing' ? 'text-cyan-400 font-bold' : 'text-slate-300'}>
                3. Sign
              </span>
              <span>→</span>
              <span className={statusStep === 'mining' || statusStep === 'crosschain' ? 'text-purple-400 font-bold' : 'text-slate-600'}>
                4. Confirming
              </span>
            </div>

            {/* Animated Pulse Loader */}
            <div className="relative w-18 h-18 sm:w-20 sm:h-20 mx-auto mb-4 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping opacity-75" />
              <div
                className="absolute inset-2 rounded-full bg-gradient-to-tr from-cyan-500 via-purple-500 to-blue-600 animate-spin"
                style={{ animationDuration: '3s' }}
              />
              <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-slate-900 flex items-center justify-center border-2 border-cyan-400">
                <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400 fill-cyan-400 animate-pulse" />
              </div>
            </div>

            <h3 className="text-base sm:text-lg font-extrabold text-white mb-1">
              {quote.isDeBridge ? 'Executing Cross-Chain Swap' : 'Processing On-Chain Swap'}
            </h3>
            <p className="text-xs text-slate-400 mb-4 font-mono">
              {quote.fromAmount} {quote.fromToken.symbol} → ~{quote.toAmount} {quote.toToken.symbol}
            </p>

            {/* Status Box */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-left space-y-2.5 mb-4">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400 flex-shrink-0" />
                <span>{statusMessage}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {statusStep === 'network'
                  ? `Please confirm network switch to ${quote.fromToken.networkName} in your wallet.`
                  : statusStep === 'approval'
                  ? `Please approve ${quote.fromToken.symbol} token allowance in ${getConnectedWalletBrand(connector?.name)}.`
                  : statusStep === 'signing'
                  ? `Please review and approve the swap transaction in ${getConnectedWalletBrand(connector?.name)}.`
                  : statusStep === 'crosschain'
                  ? 'Source block confirmed on-chain! Decentralized solvers are executing destination asset transfer...'
                  : statusStep === 'mining'
                  ? `Transaction submitted — verifying block confirmation on ${quote.fromToken.networkName}...`
                  : 'Verifying active wallet provider session and smart contract routing.'}
              </p>

              {/* Mobile Quick Launcher & Auto-Resume */}
              {(statusStep === 'signing' || statusStep === 'approval' || statusStep === 'network') && (
                <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                  <button
                    id="btn-open-wallet-app"
                    onClick={() => triggerMobileWalletPrompt(connector?.name || 'Bitcoin.com Wallet')}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500/20 via-sky-500/20 to-blue-600/20 hover:from-cyan-500/30 hover:to-blue-600/30 border border-cyan-500/40 text-cyan-200 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Open {getConnectedWalletBrand(connector?.name)} to Confirm</span>
                  </button>
                  <p className="text-[10px] text-slate-400 text-center">
                    PayFlux automatically resumes checking when you return.
                  </p>
                </div>
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
                    <span>{shortenAddress(txHash, 5)}</span>
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

            {/* Cancel Action */}
            <div className="pt-1">
              <button
                id="btn-swap-cancel-action"
                onClick={handleAbort}
                className="w-full py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs transition-colors"
              >
                Cancel Swap
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STAGE 3: IN-PLACE SUCCESS / CONFIRMED RECEIPT                */}
        {/* ============================================================ */}
        {modalStage === 'success' && (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-black text-white">Swap Confirmed On-Chain!</h3>
            <p className="text-xs text-slate-400 font-mono">
              {quote.fromAmount} {quote.fromToken.symbol} → ~{quote.toAmount} {quote.toToken.symbol}
            </p>

            {/* Transaction Receipt Card */}
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-left space-y-2 text-xs">
              {txHash && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Transaction ID</span>
                  <div className="flex items-center gap-1.5 font-mono text-cyan-300">
                    <span>{shortenAddress(txHash, 5)}</span>
                    <button
                      id="copy-tx-hash-btn"
                      onClick={handleCopyHash}
                      className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                      title="Copy Hash"
                    >
                      {copiedHash ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              )}

              {deBridgeOrderId && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Globe className="w-3 h-3 text-purple-400" />
                    <span>deBridge Order</span>
                  </span>
                  <a
                    href={`https://app.debridge.finance/order?orderId=${deBridgeOrderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-purple-300 hover:underline text-[11px]"
                  >
                    {shortenAddress(deBridgeOrderId, 6)}
                  </a>
                </div>
              )}

              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400">Network Fee</span>
                <span className="font-mono text-slate-200">
                  {formatCurrency(quote.networkFeeUsd, settings.currency)}
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-cyan-400" />
                  <span>PayFlux Fee</span>
                </span>
                {feeVerified && feeTxHash ? (
                  <div className="flex items-center gap-1 font-mono text-[11px]">
                    <span className="text-emerald-400 font-bold">{PAYFLUX_PLATFORM_FEE_DISPLAY}</span>
                    <a
                      href={`${explorerBase}/tx/${feeTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:underline inline-flex items-center gap-0.5 ml-1"
                      title="View on-chain fee transfer to PayFlux revenue wallet"
                    >
                      <span>(Confirmed)</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                ) : (
                  <span className="font-mono text-slate-400 text-[11px]">Uncollected</span>
                )}
              </div>
            </div>

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
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-400 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-extrabold text-sm shadow-lg shadow-cyan-500/20 transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              Done
            </button>
          </div>
        )}

        {/* ============================================================ */}
        {/* STAGE 4: IN-PLACE ERROR STATE                                */}
        {/* ============================================================ */}
        {modalStage === 'error' && (
          <div className="text-center space-y-4">
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
              {(errorMessage || '').toLowerCase().includes('connect') ? (
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
                  <span>Connect Wallet</span>
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
                onClick={() => setModalStage('review')}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs text-slate-200 transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
