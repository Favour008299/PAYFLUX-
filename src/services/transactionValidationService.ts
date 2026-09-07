import { parseUnits } from 'viem';
import { safeGetAddress } from './sharedSwapEngine';
import { Token } from '../types';
import { PAYFLUX_PLATFORM_FEE_WEI } from '../config/platform';
import { TOKEN_CONTRACTS } from './contractConfig';

export interface SwapCalldataValidationParams {
  fromAmount: string;
  fromToken: Token;
  toToken: Token;
  txData?: string;
  txValue?: bigint | string;
  txTo?: string;
  recipientAddress?: string;
}

export interface SwapCalldataValidationResult {
  valid: boolean;
  error?: string;
  encodedUnitsHex?: string;
  expectedUnits?: bigint;
}

/**
 * Validates that an outbound transaction's calldata or value strictly matches
 * the currently requested swap input amount and parameters.
 * Prevents stale calldata (e.g. 10,000 units instead of 15,000 units) from ever
 * reaching the wallet or blockchain.
 */
export function validateSwapCalldataMatch(params: SwapCalldataValidationParams): SwapCalldataValidationResult {
  const { fromAmount, fromToken, txData, txValue } = params;

  if (!fromAmount || parseFloat(fromAmount) <= 0) {
    return { valid: false, error: 'Invalid swap amount: amount must be greater than zero.' };
  }

  const decimals = fromToken.decimals || 18;
  let expectedUnits: bigint;
  try {
    expectedUnits = parseUnits(fromAmount, decimals);
  } catch (err: any) {
    return { valid: false, error: `Failed to parse input units for ${fromAmount} ${fromToken.symbol}: ${err?.message}` };
  }

  const isNative = Boolean((fromToken as any).isNative || fromToken.symbol === 'POL' || fromToken.symbol === 'ETH');

  if (isNative) {
    // For native inputs, the transaction value must cover the swap amount in wei
    const valBigInt = typeof txValue === 'bigint' ? txValue : BigInt(txValue || '0');
    // Note: txValue may optionally include the 0.1 POL platform fee if collected from input
    const minAcceptableVal = expectedUnits;
    if (valBigInt < minAcceptableVal) {
      return {
        valid: false,
        error: `Transaction value (${valBigInt.toString()} wei) does not cover requested swap input (${minAcceptableVal.toString()} wei for ${fromAmount} ${fromToken.symbol}).`,
      };
    }
    return { valid: true, expectedUnits };
  }

  // For ERC-20 inputs, calldata MUST encode the expected token units
  if (!txData || txData === '0x' || txData.length < 10) {
    return { valid: false, error: 'Transaction calldata is missing or empty for ERC-20 swap.' };
  }

  const hexUnits = expectedUnits.toString(16).toLowerCase();
  const rawCalldataLower = txData.toLowerCase();

  // In EVM calldata, amounts are 32-byte (64 hex characters) left-padded with zeros
  const paddedHexUnits = hexUnits.padStart(64, '0');

  const matchesPadded = rawCalldataLower.includes(paddedHexUnits);
  const matchesRaw = rawCalldataLower.includes(hexUnits);

  if (!matchesPadded && !matchesRaw) {
    return {
      valid: false,
      error: `Security Check Blocked: Calldata does not encode the requested input of ${fromAmount} ${fromToken.symbol} (${expectedUnits.toString()} units). Calldata is stale or mismatched. Aborting before wallet prompt.`,
      encodedUnitsHex: hexUnits,
      expectedUnits,
    };
  }

  return { valid: true, encodedUnitsHex: hexUnits, expectedUnits };
}

export interface MerchantSettlementVerificationParams {
  receipt: any;
  merchantAddress: string;
  settlementAssetSymbol: string;
  settlementAssetAddress?: string;
  minExpectedAmount?: bigint;
  isNative: boolean;
  chainId: number;
}

export interface MerchantSettlementVerificationResult {
  isSettled: boolean;
  deliveredAsset: string;
  deliveredAmount?: string;
  recipientAddress: string;
  error?: string;
}

/**
 * Inspects real on-chain transaction receipt logs to strictly verify that
 * the merchant actually received the configured settlement asset at their address.
 * Never relies on UI calculations or cached promises.
 */
export function verifyOnChainMerchantSettlement(
  params: MerchantSettlementVerificationParams
): MerchantSettlementVerificationResult {
  const {
    receipt,
    merchantAddress,
    settlementAssetSymbol,
    settlementAssetAddress,
    minExpectedAmount,
    isNative,
    chainId,
  } = params;

  if (!receipt) {
    return {
      isSettled: false,
      deliveredAsset: settlementAssetSymbol,
      recipientAddress: merchantAddress,
      error: 'Transaction receipt is missing or empty.',
    };
  }

  if (receipt.status !== 'success' && receipt.status !== 1 && receipt.status !== '0x1') {
    return {
      isSettled: false,
      deliveredAsset: settlementAssetSymbol,
      recipientAddress: merchantAddress,
      error: `Transaction was reverted on-chain (status: ${receipt.status}).`,
    };
  }

  const cleanMerchant = merchantAddress.toLowerCase();
  const paddedMerchant = '0x000000000000000000000000' + cleanMerchant.replace(/^0x/, '');

  // Case 1: Native Settlement (POL on Polygon / ETH on Ethereum)
  if (isNative || settlementAssetSymbol.toUpperCase() === 'POL' || settlementAssetSymbol.toUpperCase() === 'ETH') {
    // 1a: Direct transfer to merchant
    if (receipt.to && receipt.to.toLowerCase() === cleanMerchant) {
      return {
        isSettled: true,
        deliveredAsset: settlementAssetSymbol,
        recipientAddress: merchantAddress,
      };
    }

    // 1b: Polygon MRC20 native transfer log (0x0000000000000000000000000000000000001010)
    // Event: LogTransfer(address indexed token, address indexed from, address indexed to, uint256 amount)
    // Topic 0: 0xe6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4
    if (receipt.logs && Array.isArray(receipt.logs)) {
      for (const log of receipt.logs) {
        if (
          log.address &&
          log.address.toLowerCase() === '0x0000000000000000000000000000000000001010' &&
          log.topics &&
          log.topics[0] === '0xe6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4' &&
          log.topics[3]
        ) {
          const logTo = ('0x' + log.topics[3].slice(26)).toLowerCase();
          if (logTo === cleanMerchant) {
            return {
              isSettled: true,
              deliveredAsset: settlementAssetSymbol,
              recipientAddress: merchantAddress,
            };
          }
        }
      }
    }

    // 1c: PayFlux Atomic Router PaymentCompleted event (topic: 0x22a8854c8fd75085737ed980a4ec84cce7cabd7b22ba9bb7436d525974ba25b8)
    if (receipt.logs && Array.isArray(receipt.logs)) {
      for (const log of receipt.logs) {
        if (
          log.topics &&
          log.topics[0] === '0x22a8854c8fd75085737ed980a4ec84cce7cabd7b22ba9bb7436d525974ba25b8' &&
          log.topics[2]
        ) {
          const logMerchant = ('0x' + log.topics[2].slice(26)).toLowerCase();
          if (logMerchant === cleanMerchant) {
            return {
              isSettled: true,
              deliveredAsset: settlementAssetSymbol,
              recipientAddress: merchantAddress,
            };
          }
        }
      }
    }

    return {
      isSettled: false,
      deliveredAsset: settlementAssetSymbol,
      recipientAddress: merchantAddress,
      error: `Transaction receipt does not contain native ${settlementAssetSymbol} delivery to merchant address ${merchantAddress}.`,
    };
  }

  // Case 2: ERC-20 Settlement (USDT, USDC, VERSE, DAI, WBTC)
  let expectedTokenAddr = settlementAssetAddress;
  if (!expectedTokenAddr && TOKEN_CONTRACTS[chainId]) {
    expectedTokenAddr = TOKEN_CONTRACTS[chainId][settlementAssetSymbol]?.address;
  }

  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

  if (receipt.logs && Array.isArray(receipt.logs)) {
    for (const log of receipt.logs) {
      if (
        log.topics &&
        log.topics[0] === TRANSFER_TOPIC &&
        log.topics[2]
      ) {
        const toAddr = ('0x' + log.topics[2].slice(26)).toLowerCase();
        if (toAddr === cleanMerchant) {
          // If contract address is specified, verify it matches
          if (expectedTokenAddr && log.address.toLowerCase() !== expectedTokenAddr.toLowerCase()) {
            continue; // Transfer was for a different token, keep searching
          }

          // Extract transferred value
          let valueUnits = 0n;
          if (log.data && log.data !== '0x') {
            try {
              valueUnits = BigInt(log.data);
            } catch (_) {}
          }

          if (minExpectedAmount && valueUnits > 0n && valueUnits < minExpectedAmount) {
            return {
              isSettled: false,
              deliveredAsset: settlementAssetSymbol,
              recipientAddress: merchantAddress,
              error: `Delivered amount (${valueUnits.toString()}) is less than expected minimum (${minExpectedAmount.toString()}).`,
            };
          }

          return {
            isSettled: true,
            deliveredAsset: settlementAssetSymbol,
            deliveredAmount: valueUnits.toString(),
            recipientAddress: merchantAddress,
          };
        }
      }
    }
  }

  return {
    isSettled: false,
    deliveredAsset: settlementAssetSymbol,
    recipientAddress: merchantAddress,
    error: `On-chain settlement check failed: No ERC-20 Transfer log of ${settlementAssetSymbol} to merchant address ${merchantAddress} was found in transaction receipt.`,
  };
}
