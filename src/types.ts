export type NetworkType = 'ethereum' | 'polygon' | 'bitcoin' | 'bitcoincash' | 'bnb' | 'avalanche';

export type UserRole = 'customer' | 'merchant' | 'admin';

export type PaymentInvoiceStatus =
  | 'awaiting_payment'
  | 'payment_detected'
  | 'confirming'
  | 'paid'
  | 'failed'
  | 'expired';

export interface MerchantInvoice {
  id: string;
  merchantName: string;
  merchantAddress: string;
  productName: string;
  description?: string;
  reference?: string;
  fiatAmount: number; // e.g. 5000 in NGN or 15.00 in USD
  fiatCurrency?: string; // e.g. 'NGN' | 'USD' | 'EUR' | 'GBP'
  targetToken: string; // Token merchant prefers: 'VERSE' | 'POL' | 'USDT' | 'USDC' | 'ETH' | 'BCH' | 'BTC' | 'DAI'
  targetAmount: number; // Exact amount calculated based on targetToken
  network: NetworkType;
  chainId: number;
  status: PaymentInvoiceStatus;
  createdAt: number;
  expiresAt: number;
  // Paid details
  paidTxHash?: string;
  payerAddress?: string;
  paidToken?: string;
  paidAmount?: string;
  paidExchangeRate?: number;
  networkFeeUsd?: number;
  payfluxFeeUsd?: number; // $0.10 platform fee
  paidTimestamp?: number;
  blockNumber?: number;
  explorerUrl?: string;
}

export interface CustomerPaymentReceipt {
  id: string;
  invoiceId?: string;
  merchantName: string;
  merchantAddress: string;
  productName: string;
  payerAddress: string; // Customer's connected wallet
  amountPaid: string;
  tokenSymbol: string;
  merchantReceivedAmount?: string;
  merchantReceivedAsset?: string;
  routingProtocol?: string;
  isConverted?: boolean;
  fiatValueUsd: number;
  fiatAmount?: number;
  fiatCurrency?: string;
  payfluxFeeUsd?: number; // $0.10 fixed fee
  feeStatus?: 'confirmed' | 'pending' | 'failed' | 'uncollected';
  feeTxHash?: string;
  feeRecipient?: string;
  txHash: string;
  network: NetworkType;
  chainId: number;
  timestamp: number;
  status: 'completed' | 'pending' | 'failed';
  networkFeeUsd: number;
  explorerUrl: string;
  failureReason?: string;
  blockNumber?: number;
}

export interface Token {
  id?: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  change24h: number;
  balance: number;
  iconBg: string;
  iconColor: string;
  logoUrl?: string;
  network: NetworkType;
  networkName: string;
  isFavorite?: boolean;
  contractAddress?: string;
  category: 'core' | 'defi' | 'stablecoin' | 'layer2';
  sparkline: number[];
  isPriceUnavailable?: boolean;
}

export interface WalletAccount {
  address: string;
  name: string;
  brand?: string;
  type: 'bitcoin_com' | 'wallet_connect' | 'metamask' | 'created' | 'trust_wallet';
  recoveryPhraseBackedUp: boolean;
  network: NetworkType;
  portfolioBalanceUsd: number;
  tokens: Record<string, number>; // symbol -> balance
  tokenBalancesById?: Record<string, number>; // token id -> balance
  encryptedPin?: string;
  createdAt: number;
}

export interface SwapQuote {
  fromToken: Token;
  toToken: Token;
  fromAmount: string;
  toAmount: string;
  exchangeRate: number; // 1 fromToken = x toToken
  inverseRate: number;
  priceImpact: number; // percentage
  networkFeeUsd: number;
  networkFeeToken: string;
  slippageTolerance: number;
  minimumReceived: string;
  route: string;
  estimatedTimeSeconds: number;
  gasSpeed: 'eco' | 'standard' | 'fast';
  // deBridge & Router fields
  routingProtocol?: string;
  orderId?: string;
  isDeBridge?: boolean;
  swapTx?: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    allowanceTarget?: `0x${string}`;
    allowanceValue?: string;
  };
  deBridgeTx?: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    allowanceTarget?: `0x${string}`;
    allowanceValue?: string;
  };
  costsDetails?: Array<{
    type: string;
    chain: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
  }>;
  fixFee?: string;
}

export type TxStatus = 'completed' | 'pending' | 'failed';
export type TxType = 'swap' | 'send' | 'receive' | 'stake' | 'payment';

export interface TransactionRecord {
  id: string;
  hash: string;
  type: TxType;
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  fromAmount?: string;
  toAmount?: string;
  tokenSymbol?: string; // for send/receive/payment
  amount?: string;
  merchantName?: string;
  productName?: string;
  recipientAddress?: string;
  senderAddress?: string;
  userAddress?: string;
  walletAddress?: string;
  payerAddress?: string;
  timestamp: number;
  status: TxStatus;
  networkFeeUsd: number;
  payfluxFeeUsd?: number;
  blockNumber: number;
  explorerUrl: string;
  network: NetworkType;
  orderId?: string;
  deBridgeTrackingUrl?: string;
  failureReason?: string;
  merchantReceivedAmount?: string;
  merchantReceivedAsset?: string;
  feeStatus?: 'confirmed' | 'pending' | 'failed' | 'uncollected';
  feeTxHash?: string;
}

export interface UserSettings {
  theme: 'dark' | 'light';
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'NGN' | 'AUD' | 'CAD';
  slippageTolerance: number; // e.g. 0.5
  gasSpeed: 'eco' | 'standard' | 'fast';
  autoLockMinutes: number;
  pinProtected: boolean;
  expertMode: boolean;
  audioFeedback: boolean;
}

export interface StakingPool {
  id: string;
  tokenSymbol: string;
  name: string;
  apr: number;
  totalStaked: string;
  userStaked: number;
  rewardsEarned: number;
  lockPeriodDays: number;
}

export interface PlatformAnalytics {
  totalTransactions: number;
  totalVolumeUsd: number;
  totalPayfluxRevenueUsd: number; // $0.10 * (successful payments + successful swaps)
  paymentRevenueUsd: number;
  swapRevenueUsd: number;
  totalMerchantsCount: number;
  totalCustomersCount: number;
  successfulCount: number;
  failedCount: number;
  totalSwapsCount: number;
  recentActivity: CustomerPaymentReceipt[];
}

export type SwapExecutionStatus = 'attempted' | 'pending' | 'confirmed' | 'success' | 'failed' | 'rejected' | 'cancelled';

export interface SwapTransactionRecord {
  id: string;
  userAddress: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
  fromAmount: string;
  toAmount: string;
  fromAmountUsd: number;
  toAmountUsd: number;
  pair: string; // e.g. "VERSE/POL"
  network: NetworkType;
  chainId: number;
  status: SwapExecutionStatus;
  failureReason?: string;
  txHash?: string;
  blockNumber?: number;
  timestamp: number;
  updatedAt?: number;
  explorerUrl?: string;
  isCrossChain?: boolean;
  routingProtocol?: string;
  orderId?: string;
  payfluxFeeUsd?: number;
  feeRecipient?: string;
  feeToken?: string;
  feeAmountToken?: string;
  feeStatus?: 'confirmed' | 'pending' | 'failed' | 'uncollected';
  feeTxHash?: string;
  feeBlockNumber?: number;
  feeConfirmedAt?: number;
}

export interface SwapPairStat {
  pair: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  totalAttempts: number;
  successfulCount: number;
  failedCount: number;
  volumeUsd: number;
  successRate: number; // 0 to 100 percentage
}

export interface SwapAnalyticsSummary {
  totalAttempts: number;
  successfulSwaps: number;
  failedSwaps: number;
  pendingSwaps: number;
  rejectedSwaps?: number;
  cancelledSwaps?: number;
  uniqueUsersCount: number;
  totalSwapVolumeUsd: number;
  totalSwapFeesUsd: number;
  mostUsedPairs: SwapPairStat[];
  recentSwaps: SwapTransactionRecord[];
}
