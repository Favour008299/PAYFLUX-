/**
 * Real-time Cryptocurrency Live Pricing and Conversion Service
 * Queries live market data feeds (CoinGecko, verified DEX contracts & Binance fallback)
 * strictly without fake, hardcoded, or estimated token prices.
 *
 * Bitcoin.com VERSE is specifically verified by its official contract addresses:
 * - Ethereum: 0x249cA82617eC3DfB2589c4c17ab7EC9765350a18
 * - Polygon:  0xc708D6F2153933DAA50B2D0758955Be0A93A8FEc
 * - CoinGecko ID: 'verse-bitcoin'
 */

export interface LiveTokenPrice {
  symbol: string;
  tokenId?: string;
  network?: string;
  contractAddress?: string;
  priceUsd: number;
  change24h: number;
  isPriceUnavailable?: boolean;
  lastUpdated: number;
}

export interface TokenPriceDefinition {
  tokenId: string;
  symbol: string;
  network: string;
  contractAddress?: string;
  coingeckoId: string;
  binancePair?: string;
}

export const SUPPORTED_TOKEN_PRICE_DEFINITIONS: TokenPriceDefinition[] = [
  {
    tokenId: 'verse-polygon',
    symbol: 'VERSE',
    network: 'polygon',
    contractAddress: '0xc708D6F2153933DAA50B2D0758955Be0A93A8FEc',
    coingeckoId: 'verse-bitcoin',
  },
  {
    tokenId: 'verse-ethereum',
    symbol: 'VERSE',
    network: 'ethereum',
    contractAddress: '0x249cA82617eC3DfB2589c4c17ab7EC9765350a18',
    coingeckoId: 'verse-bitcoin',
  },
  {
    tokenId: 'pol-polygon',
    symbol: 'POL',
    network: 'polygon',
    coingeckoId: 'polygon-ecosystem-token',
    binancePair: 'POLUSDT',
  },
  {
    tokenId: 'eth-ethereum',
    symbol: 'ETH',
    network: 'ethereum',
    coingeckoId: 'ethereum',
    binancePair: 'ETHUSDT',
  },
  {
    tokenId: 'usdt-polygon',
    symbol: 'USDT',
    network: 'polygon',
    contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    coingeckoId: 'tether',
  },
  {
    tokenId: 'usdc-polygon',
    symbol: 'USDC',
    network: 'polygon',
    contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    coingeckoId: 'usd-coin',
    binancePair: 'USDCUSDT',
  },
  {
    tokenId: 'usdt-ethereum',
    symbol: 'USDT',
    network: 'ethereum',
    contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    coingeckoId: 'tether',
  },
  {
    tokenId: 'usdc-ethereum',
    symbol: 'USDC',
    network: 'ethereum',
    contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    coingeckoId: 'usd-coin',
    binancePair: 'USDCUSDT',
  },
  {
    tokenId: 'dai-polygon',
    symbol: 'DAI',
    network: 'polygon',
    contractAddress: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    coingeckoId: 'dai',
    binancePair: 'DAIUSDT',
  },
  {
    tokenId: 'wbtc-polygon',
    symbol: 'WBTC',
    network: 'polygon',
    contractAddress: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
    coingeckoId: 'wrapped-bitcoin',
    binancePair: 'WBTCUSDT',
  },
  {
    tokenId: 'btc-bitcoin',
    symbol: 'BTC',
    network: 'bitcoin',
    coingeckoId: 'bitcoin',
    binancePair: 'BTCUSDT',
  },
  {
    tokenId: 'bch-bitcoincash',
    symbol: 'BCH',
    network: 'bitcoincash',
    coingeckoId: 'bitcoin-cash',
    binancePair: 'BCHUSDT',
  },
];

// In-memory cache with 25s freshness to prevent rate limits
let priceCache: Record<string, LiveTokenPrice> = {};
let lastFetchTime = 0;
const CACHE_DURATION_MS = 25000;

// Rate-limit backoff tracker for public APIs
let coinGeckoRateLimitedUntil = 0;

/**
 * Fetch real-time DEX price for VERSE directly from on-chain pools via DEXScreener
 */
async function fetchVerseVerifiedContractPrice(): Promise<{ priceUsd: number; change24h: number } | null> {
  // 1. Try DEXScreener token endpoint (Ethereum VERSE contract 0x249cA82617eC3DfB2589c4c17ab7EC9765350a18)
  try {
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/0x249cA82617eC3DfB2589c4c17ab7EC9765350a18',
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data.pairs && data.pairs.length > 0) {
        const bestPair = data.pairs.reduce((prev: any, current: any) => {
          return (current.liquidity?.usd || 0) > (prev.liquidity?.usd || 0) ? current : prev;
        }, data.pairs[0]);

        if (bestPair && bestPair.priceUsd) {
          const price = parseFloat(bestPair.priceUsd);
          const change = bestPair.priceChange?.h24 ? parseFloat(bestPair.priceChange.h24) : 0;
          if (!isNaN(price) && price > 0) {
            return { priceUsd: price, change24h: change };
          }
        }
      }
    }
  } catch (_) {
    // Non-fatal, try next
  }

  // 2. Try DEXScreener token endpoint (Polygon VERSE contract 0xc708d6F2153933DAA50B2D0758955Be0A93A8FEc)
  try {
    const polyRes = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/0xc708d6F2153933DAA50B2D0758955Be0A93A8FEc',
      { signal: AbortSignal.timeout(5000) }
    );
    if (polyRes.ok) {
      const polyData = await polyRes.json();
      if (polyData && polyData.pairs && polyData.pairs.length > 0) {
        const bestPair = polyData.pairs.reduce((prev: any, current: any) => {
          return (current.liquidity?.usd || 0) > (prev.liquidity?.usd || 0) ? current : prev;
        }, polyData.pairs[0]);

        if (bestPair && bestPair.priceUsd) {
          const price = parseFloat(bestPair.priceUsd);
          const change = bestPair.priceChange?.h24 ? parseFloat(bestPair.priceChange.h24) : 0;
          if (!isNaN(price) && price > 0) {
            return { priceUsd: price, change24h: change };
          }
        }
      }
    }
  } catch (_) {
    // Non-fatal
  }

  return null;
}

/**
 * Fetch real-time live prices from CoinGecko API using verified IDs with rate-limit protection
 */
async function fetchCoinGeckoPrices(): Promise<Record<string, { priceUsd: number; change24h: number }> | null> {
  const now = Date.now();
  if (now < coinGeckoRateLimitedUntil) {
    return null;
  }

  try {
    const uniqueIds = Array.from(new Set(SUPPORTED_TOKEN_PRICE_DEFINITIONS.map((t) => t.coingeckoId))).join(',');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueIds}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (res.status === 429) {
      // Backoff for 60 seconds if rate limited
      coinGeckoRateLimitedUntil = Date.now() + 60000;
      return null;
    }

    if (!res.ok) return null;
    const data = await res.json();

    const results: Record<string, { priceUsd: number; change24h: number }> = {};
    for (const [cgId, val] of Object.entries(data)) {
      if (val && typeof (val as any).usd === 'number') {
        results[cgId] = {
          priceUsd: (val as any).usd,
          change24h: (val as any).usd_24h_change || 0,
        };
      }
    }
    return Object.keys(results).length > 0 ? results : null;
  } catch (_) {
    return null;
  }
}

/**
 * Fetch real-time live prices from Binance 24h Ticker API fallback
 */
async function fetchBinancePrices(): Promise<Record<string, { priceUsd: number; change24h: number }> | null> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const items: Array<{ symbol: string; lastPrice: string; priceChangePercent: string }> = await res.json();
    const map = new Map(items.map((i) => [i.symbol, { price: parseFloat(i.lastPrice), change: parseFloat(i.priceChangePercent) }]));

    const results: Record<string, { priceUsd: number; change24h: number }> = {};
    for (const def of SUPPORTED_TOKEN_PRICE_DEFINITIONS) {
      if (def.binancePair) {
        const data = map.get(def.binancePair);
        if (data && !isNaN(data.price) && data.price > 0) {
          results[def.coingeckoId] = {
            priceUsd: data.price,
            change24h: !isNaN(data.change) ? data.change : 0,
          };
        }
      }
    }
    return Object.keys(results).length > 0 ? results : null;
  } catch (err) {
    console.warn('[LivePricing] Binance ticker notice:', err);
    return null;
  }
}

/**
 * Get all current live token prices with comprehensive token key mappings
 */
export async function getLiveTokenPrices(): Promise<{
  prices: Record<string, LiveTokenPrice>;
  isLive: boolean;
}> {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_DURATION_MS && Object.keys(priceCache).length > 0) {
    return { prices: priceCache, isLive: true };
  }

  const [verseContractPrice, coinGeckoData] = await Promise.allSettled([
    fetchVerseVerifiedContractPrice(),
    fetchCoinGeckoPrices(),
  ]);

  let liveCgMap: Record<string, { priceUsd: number; change24h: number }> = {};

  if (coinGeckoData.status === 'fulfilled' && coinGeckoData.value) {
    liveCgMap = { ...coinGeckoData.value };
  } else {
    const binanceData = await fetchBinancePrices();
    if (binanceData) {
      liveCgMap = { ...binanceData };
    }
  }

  // If verified contract DEX query for VERSE returned a price, prioritize it or merge with verse-bitcoin
  if (verseContractPrice.status === 'fulfilled' && verseContractPrice.value) {
    liveCgMap['verse-bitcoin'] = verseContractPrice.value;
  }

  const results: Record<string, LiveTokenPrice> = {};

  for (const def of SUPPORTED_TOKEN_PRICE_DEFINITIONS) {
    const priceInfo = liveCgMap[def.coingeckoId];
    const isAvailable = !!(priceInfo && typeof priceInfo.priceUsd === 'number' && priceInfo.priceUsd > 0);
    const tokenPriceObj: LiveTokenPrice = {
      symbol: def.symbol,
      tokenId: def.tokenId,
      network: def.network,
      contractAddress: def.contractAddress,
      priceUsd: isAvailable ? priceInfo.priceUsd : 0,
      change24h: isAvailable ? priceInfo.change24h : 0,
      isPriceUnavailable: !isAvailable,
      lastUpdated: now,
    };

    // Index by multiple keys for reliable lookup:
    // 1. Exact tokenId (e.g. 'verse-polygon', 'verse-ethereum')
    results[def.tokenId] = tokenPriceObj;
    // 2. Network + Symbol (e.g. 'polygon:VERSE', 'ethereum:VERSE')
    results[`${def.network.toLowerCase()}:${def.symbol.toUpperCase()}`] = tokenPriceObj;
    // 3. Symbol fallback (e.g. 'VERSE', 'POL', 'ETH')
    if (!results[def.symbol.toUpperCase()] || isAvailable) {
      results[def.symbol.toUpperCase()] = tokenPriceObj;
    }
  }

  const hasLive = Object.values(results).some((p) => !p.isPriceUnavailable && p.priceUsd > 0);

  if (hasLive) {
    priceCache = { ...priceCache, ...results };
    lastFetchTime = now;
    return { prices: priceCache, isLive: true };
  }

  if (Object.keys(priceCache).length > 0) {
    return { prices: priceCache, isLive: true };
  }

  return { prices: results, isLive: false };
}

/**
 * Calculate exact payment conversion between requested fiat / token and customer chosen token
 */
export async function calculatePaymentQuote(params: {
  amountDueUsd: number;
  payTokenSymbol: string;
}): Promise<{
  tokenAmount: string;
  tokenPriceUsd: number;
  exchangeRateText: string;
  isAvailable: boolean;
}> {
  const { prices, isLive } = await getLiveTokenPrices();

  const tokenData = prices[params.payTokenSymbol.toUpperCase()];
  if (!tokenData || tokenData.isPriceUnavailable || !tokenData.priceUsd || tokenData.priceUsd <= 0) {
    return {
      tokenAmount: '0',
      tokenPriceUsd: 0,
      exchangeRateText: 'Price unavailable',
      isAvailable: false,
    };
  }

  const rawTokenAmount = params.amountDueUsd / tokenData.priceUsd;

  let formattedAmount: string;
  if (rawTokenAmount > 1000) {
    formattedAmount = rawTokenAmount.toFixed(2);
  } else if (rawTokenAmount > 1) {
    formattedAmount = rawTokenAmount.toFixed(4);
  } else if (rawTokenAmount > 0.001) {
    formattedAmount = rawTokenAmount.toFixed(6);
  } else {
    formattedAmount = rawTokenAmount.toFixed(8);
  }

  return {
    tokenAmount: formattedAmount,
    tokenPriceUsd: tokenData.priceUsd,
    exchangeRateText: `1 ${params.payTokenSymbol} = $${tokenData.priceUsd.toLocaleString('en-US', {
      maximumFractionDigits: tokenData.priceUsd < 1 ? 6 : 2,
    })}`,
    isAvailable: isLive && rawTokenAmount > 0,
  };
}
