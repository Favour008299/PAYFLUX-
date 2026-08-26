import { isValidEVMAddress } from './crypto';

export interface ParsedQRPayment {
  raw: string;
  address?: string;
  amount?: number;
  fiatAmount?: number;
  priceAmount?: number;
  fiatCurrency?: string;
  receivingAsset?: string;
  token?: string;
  network?: string;
  invoiceId?: string;
  merchantName?: string;
  productName?: string;
  isValid: boolean;
  error?: string;
}

/**
 * Parses raw text read from QR codes into a structured payment object.
 * Supports:
 * - PayFlux protocol (payflux:checkout?...)
 * - Plain EVM 0x address
 * - EIP-681 standard (ethereum:0x... or polygon:0x...)
 * - Web app Pay links (https://.../pay?address=0x... or ?invoice=inv-...)
 * - Structured JSON payment payloads
 */
export function parseQRPaymentData(rawText: string): ParsedQRPayment {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { raw: rawText, isValid: false, error: 'Empty QR code data' };
  }

  // 1. PayFlux Native Protocol URI (payflux:checkout?... or payflux:payment?...)
  if (trimmed.startsWith('payflux:')) {
    try {
      const queryPart = trimmed.includes('?') ? trimmed.split('?')[1] : trimmed.replace(/^payflux:[a-zA-Z_]+\??/, '');
      const searchParams = new URLSearchParams(queryPart);
      const addr = searchParams.get('address') || searchParams.get('merchantAddress') || searchParams.get('to');
      const merchantName = searchParams.get('merchant') || searchParams.get('merchantName');
      const productName = searchParams.get('product') || searchParams.get('productName');
      const priceStr = searchParams.get('price') || searchParams.get('amount') || searchParams.get('fiat');
      const currency = searchParams.get('currency') || searchParams.get('fiatCurrency') || 'NGN';
      const receiveToken = searchParams.get('receiveToken') || searchParams.get('token') || searchParams.get('targetToken');
      const network = searchParams.get('network') || 'polygon';
      const invoiceId = searchParams.get('invoice') || searchParams.get('invoiceId');

      if (addr && isValidEVMAddress(addr)) {
        const numPrice = priceStr ? parseFloat(priceStr) : undefined;
        return {
          raw: rawText,
          address: addr,
          merchantName: merchantName ? decodeURIComponent(merchantName) : undefined,
          productName: productName ? decodeURIComponent(productName) : undefined,
          priceAmount: numPrice,
          fiatAmount: numPrice,
          fiatCurrency: currency,
          receivingAsset: receiveToken || undefined,
          token: receiveToken || undefined,
          network,
          invoiceId: invoiceId || undefined,
          isValid: true,
        };
      }
    } catch (e) {
      console.warn('PayFlux QR parsing notice:', e);
    }
  }

  // 2. Plain EVM address
  if (isValidEVMAddress(trimmed)) {
    return {
      raw: rawText,
      address: trimmed,
      isValid: true,
    };
  }

  // 3. Structured JSON payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      const addr = parsed.address || parsed.merchantAddress || parsed.to || parsed.recipient;
      if (addr && isValidEVMAddress(addr)) {
        return {
          raw: rawText,
          address: addr,
          amount: typeof parsed.amount === 'number' ? parsed.amount : parseFloat(parsed.amount) || undefined,
          fiatAmount: typeof parsed.fiatAmount === 'number' ? parsed.fiatAmount : parseFloat(parsed.fiatAmount) || undefined,
          priceAmount: typeof parsed.priceAmount === 'number' ? parsed.priceAmount : parseFloat(parsed.priceAmount) || undefined,
          fiatCurrency: parsed.fiatCurrency || parsed.currency,
          receivingAsset: parsed.receivingAsset || parsed.receiveToken,
          token: parsed.token || parsed.targetToken || parsed.symbol,
          network: parsed.network,
          invoiceId: parsed.invoiceId || parsed.id,
          merchantName: parsed.merchantName,
          productName: parsed.productName,
          isValid: true,
        };
      }
    } catch {
      // Ignore JSON parse error, continue
    }
  }

  // 4. EIP-681 / Standard EVM URI (e.g. ethereum:0x123... or polygon:0x123...)
  const uriMatch = trimmed.match(/^(?:ethereum|polygon|arbitrum|optimism|base|bsc|web\+pay):([0-9a-zA-Z]+)(?:\?(.*))?$/i);
  if (uriMatch) {
    const rawAddr = uriMatch[1];
    const fullAddr = rawAddr.startsWith('0x') ? rawAddr : `0x${rawAddr}`;
    if (isValidEVMAddress(fullAddr)) {
      const result: ParsedQRPayment = {
        raw: rawText,
        address: fullAddr,
        isValid: true,
      };

      const queryString = uriMatch[2];
      if (queryString) {
        const searchParams = new URLSearchParams(queryString);
        const val = searchParams.get('value') || searchParams.get('amount') || searchParams.get('price') || searchParams.get('fiat');
        if (val) {
          const num = parseFloat(val);
          if (!isNaN(num)) {
            result.amount = num;
            result.fiatAmount = num;
            result.priceAmount = num;
          }
        }
        const tok = searchParams.get('token') || searchParams.get('symbol') || searchParams.get('receiveToken');
        if (tok) {
          result.token = tok;
          result.receivingAsset = tok;
        }
        const curr = searchParams.get('currency') || searchParams.get('fiatCurrency');
        if (curr) result.fiatCurrency = curr;
        const merch = searchParams.get('merchant') || searchParams.get('merchantName');
        if (merch) result.merchantName = decodeURIComponent(merch);
        const prod = searchParams.get('product') || searchParams.get('productName');
        if (prod) result.productName = decodeURIComponent(prod);
        const inv = searchParams.get('invoice') || searchParams.get('invoiceId') || searchParams.get('id');
        if (inv) result.invoiceId = inv;
      }
      return result;
    }
  }

  // 5. URL format with query parameters (e.g. https://domain.com/pay?address=0x... or ?invoice=inv-...)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const addr = url.searchParams.get('address') || url.searchParams.get('merchantAddress') || url.searchParams.get('to');
      const invId = url.searchParams.get('invoice') || url.searchParams.get('invoiceId') || url.searchParams.get('id');
      const amt = url.searchParams.get('amount') || url.searchParams.get('fiatAmount') || url.searchParams.get('price') || url.searchParams.get('usd');
      const tok = url.searchParams.get('token') || url.searchParams.get('targetToken') || url.searchParams.get('receiveToken');
      const curr = url.searchParams.get('currency') || url.searchParams.get('fiatCurrency');
      const merch = url.searchParams.get('merchant') || url.searchParams.get('merchantName');
      const prod = url.searchParams.get('product') || url.searchParams.get('productName');

      if (addr && isValidEVMAddress(addr)) {
        return {
          raw: rawText,
          address: addr,
          invoiceId: invId || undefined,
          amount: amt ? parseFloat(amt) : undefined,
          fiatAmount: amt ? parseFloat(amt) : undefined,
          priceAmount: amt ? parseFloat(amt) : undefined,
          fiatCurrency: curr || undefined,
          token: tok || undefined,
          receivingAsset: tok || undefined,
          merchantName: merch ? decodeURIComponent(merch) : undefined,
          productName: prod ? decodeURIComponent(prod) : undefined,
          network: url.searchParams.get('network') || undefined,
          isValid: true,
        };
      }
    } catch {
      // Ignore URL parse error
    }
  }

  // 6. Generic address extraction fallback (if raw text contains an EVM address anywhere)
  const genericAddrMatch = trimmed.match(/(0x[a-fA-F0-9]{40})/i);
  if (genericAddrMatch && isValidEVMAddress(genericAddrMatch[1])) {
    return {
      raw: rawText,
      address: genericAddrMatch[1],
      isValid: true,
    };
  }

  return {
    raw: rawText,
    isValid: false,
    error: 'Unrecognized QR code format. Please scan a valid PayFlux merchant QR code or EVM address.',
  };
}
