import React, { useState } from 'react';
import {
  X,
  Send,
  Fuel,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  ArrowRight,
  ChevronDown
} from 'lucide-react';
import { useAccount } from 'wagmi';
import { useAppKitAccount, useAppKitProvider, useWalletInfo } from '@reown/appkit/react';
import { parseUnits, encodeFunctionData } from 'viem';
import { Token, WalletAccount, UserSettings, TransactionRecord } from '../types';
import { formatCurrency, formatTokenAmount, shortenAddress } from '../utils/crypto';
import { TokenIcon } from './TokenIcon';
import { QRScannerModal } from './QRScannerModal';
import { ParsedQRPayment } from '../utils/qrParser';
import {
  safeGetAddress,
  isNativeAddress,
  ERC20_STANDARD_ABI,
  polygonRpcClient,
  ethereumRpcClient,
  ZERO_ADDRESS
} from '../services/sharedSwapEngine';
import { verifyActiveSigningSession, triggerMobileWalletPrompt, sendTransactionWithRetry } from '../services/walletSigningService';

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  wallet: WalletAccount;
  settings: UserSettings;
  onSendComplete: (tx: TransactionRecord) => void;
}

export const SendModal: React.FC<SendModalProps> = ({
  isOpen,
  onClose,
  tokens,
  wallet,
  settings,
  onSendComplete,
}) => {
  const { connector } = useAccount();
  const { address: appKitAddress } = useAppKitAccount();
  const { walletProvider: appKitProvider } = useAppKitProvider('eip155');
  const { walletInfo } = useWalletInfo();

  const [selectedToken, setSelectedToken] = useState<Token>(tokens[0]);
  const [recipient, setRecipient] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const parsedAmount = parseFloat(amount) || 0;
  const userBalance = selectedToken.balance;
  const networkFeeUsd = selectedToken.network === 'ethereum' ? 2.5 : 0.04;

  const handleSend = async () => {
    const cleanRecipient = safeGetAddress(recipient.trim());
    if (cleanRecipient === ZERO_ADDRESS) {
      setError('Please enter a valid EVM recipient address (0x...).');
      return;
    }
    if (parsedAmount <= 0) {
      setError('Please enter a valid transfer amount greater than 0.');
      return;
    }
    if (parsedAmount > userBalance) {
      setError(`Insufficient ${selectedToken.symbol} balance.`);
      return;
    }

    setError(null);
    setIsSending(true);

    try {
      const targetChainId = selectedToken.network === 'ethereum' ? 1 : 137;
      const targetRpcClient = targetChainId === 137 ? polygonRpcClient : ethereumRpcClient;
      const explorerBase = selectedToken.network === 'ethereum' ? 'https://etherscan.io' : 'https://polygonscan.com';
      const isNative = isNativeAddress(selectedToken.contractAddress);
      
      const decimals = selectedToken.decimals || 18;
      const safeAmountStr = (() => {
        const parts = amount.trim().split('.');
        if (parts.length > 1 && parts[1].length > decimals) {
          return `${parts[0]}.${parts[1].substring(0, decimals)}`;
        }
        return amount.trim();
      })();
      const rawAmount = parseUnits(safeAmountStr, decimals);

      const session = await verifyActiveSigningSession({
        connector,
        appKitProvider,
        expectedAccount: wallet.address,
        targetChainId,
      });

      const tokenAddr = safeGetAddress(selectedToken.contractAddress);
      const transferCalldata = isNative
        ? undefined
        : encodeFunctionData({
            abi: ERC20_STANDARD_ABI,
            functionName: 'transfer',
            args: [cleanRecipient, rawAmount],
          });

      // Pre-flight gas estimation with fallback default limits for reliable mobile wallet signing
      let estimatedGas: bigint | undefined = undefined;
      try {
        const rawGas = await targetRpcClient.estimateGas({
          account: session.account,
          to: isNative ? cleanRecipient : tokenAddr,
          data: transferCalldata,
          value: isNative ? rawAmount : 0n,
        });
        const buffered = (rawGas * 130n) / 100n;
        estimatedGas = buffered < 65000n ? 65000n : buffered;
      } catch (gasErr) {
        console.warn('[SendModal] Gas estimation notice:', gasErr);
        estimatedGas = isNative ? 35000n : 85000n;
      }

      const txParams: any = {
        from: session.account,
        to: isNative ? cleanRecipient : tokenAddr,
        value: isNative ? '0x' + rawAmount.toString(16) : '0x0',
      };
      if (transferCalldata) {
        txParams.data = transferCalldata;
      }
      if (estimatedGas) {
        txParams.gas = '0x' + estimatedGas.toString(16);
      }

      // Prompt mobile wallet app if connected via mobile WalletConnect
      triggerMobileWalletPrompt(walletInfo?.name, (walletInfo as any)?.mobile_link);

      const txHash = await sendTransactionWithRetry(
        session.provider,
        txParams,
        90000,
        `${selectedToken.symbol} transfer confirmation timed out. Please check your wallet app.`
      );

      const receipt = await targetRpcClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 90000,
      });

      if (receipt.status === 'reverted') {
        throw new Error(`Transaction reverted on-chain (Tx: ${txHash})`);
      }

      const tx: TransactionRecord = {
        id: `tx-${Date.now()}`,
        hash: txHash,
        type: 'send',
        tokenSymbol: selectedToken.symbol,
        amount: safeAmountStr,
        recipientAddress: cleanRecipient,
        senderAddress: session.account,
        timestamp: Date.now(),
        status: 'completed',
        networkFeeUsd,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `${explorerBase}/tx/${txHash}`,
        network: selectedToken.network,
      };

      setIsSending(false);
      onSendComplete(tx);
      onClose();
    } catch (sendErr: any) {
      console.error('Send transfer error:', sendErr);
      setIsSending(false);
      const rawMsg = sendErr?.shortMessage || sendErr?.message || String(sendErr || 'Transaction failed');
      const msg = typeof rawMsg === 'string' ? rawMsg : String(rawMsg);
      const lower = msg.toLowerCase();
      if (
        lower.includes('user rejected') ||
        lower.includes('denied') ||
        lower.includes('disapproved') ||
        lower.includes('rejected by user') ||
        lower.includes('action_rejected')
      ) {
        setError('Transaction rejected in your wallet.');
      } else if (
        lower.includes('insufficient funds') ||
        lower.includes('exceeds balance') ||
        lower.includes('gas * price + value')
      ) {
        setError(`Insufficient gas (POL/ETH) or ${selectedToken.symbol} balance to complete transfer.`);
      } else if (lower.includes('timed out')) {
        setError('Transfer confirmation timed out. Please check your wallet app.');
      } else if (lower.includes('reverted')) {
        setError('Transfer transaction reverted on-chain. Please check token balance and network fees.');
      } else {
        setError(msg);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="send-crypto-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <Send className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">Send Crypto</h3>
              <p className="text-[11px] text-slate-400">Transfer tokens securely on-chain</p>
            </div>
          </div>
          <button
            id="close-send-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="py-4 space-y-3.5">
          {/* Asset picker */}
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Select Asset
            </label>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {tokens.slice(0, 5).map((t) => {
                const tokenKey = t.id || `${t.symbol}-${t.network}`;
                const isSelected = selectedToken.id === t.id || (selectedToken.symbol === t.symbol && selectedToken.network === t.network);
                return (
                  <button
                    key={tokenKey}
                    onClick={() => setSelectedToken(t)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <TokenIcon token={t} size="xs" />
                    <span>{t.symbol}</span>
                    <span className="text-[9px] text-slate-500 capitalize">({t.network === 'polygon' ? 'POL' : 'ETH'})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Recipient Address */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Recipient Address
              </label>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 hover:underline"
                >
                  <QrCode className="w-3 h-3" />
                  <span>Scan / Upload QR</span>
                </button>
                <span className="text-slate-700">•</span>
                <button
                  type="button"
                  onClick={() => setRecipient('0x71C849b29F8a5dF2d58B24eB740459bFc30484F3')}
                  className="text-[10px] text-slate-400 hover:text-slate-300 font-medium"
                >
                  Paste Demo
                </button>
              </div>
            </div>
            <input
              id="send-recipient-input"
              type="text"
              placeholder="0x... or EVM address"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Amount input */}
          <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Amount</span>
              <span className="text-[11px] text-slate-400">
                Available: {formatTokenAmount(userBalance)} {selectedToken.symbol}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <input
                id="send-amount-input"
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-transparent text-xl font-extrabold text-white font-mono focus:outline-none placeholder-slate-600"
              />
              <button
                onClick={() => setAmount(userBalance.toString())}
                className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-bold text-xs hover:bg-cyan-500/30 transition-colors"
              >
                MAX
              </button>
            </div>

            <div className="mt-1 text-xs text-slate-400 font-mono">
              ≈ {formatCurrency(parsedAmount * selectedToken.priceUsd, settings.currency)}
            </div>
          </div>

          {/* Gas Fee info */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300">
            <span className="text-slate-400 flex items-center gap-1">
              <Fuel className="w-3.5 h-3.5 text-slate-400" />
              <span>Est. Network Fee</span>
            </span>
            <span className="font-mono font-medium text-slate-200">
              ~{formatCurrency(networkFeeUsd, settings.currency)}
            </span>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Send Button */}
          <button
            id="send-submit-btn"
            disabled={isSending}
            onClick={handleSend}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4 fill-current" />
            <span>{isSending ? 'Broadcasting Transaction...' : `Send ${selectedToken.symbol}`}</span>
          </button>
        </div>
      </div>

      {/* QR Scanner / Image Upload Modal */}
      {isScannerOpen && (
        <QRScannerModal
          isOpen={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          onScanSuccess={(result) => {
            if (result.address) {
              setRecipient(result.address);
            }
            if (result.amount) {
              setAmount(result.amount.toString());
            }
            setIsScannerOpen(false);
          }}
        />
      )}
    </div>
  );
};
