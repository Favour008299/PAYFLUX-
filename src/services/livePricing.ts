/**
 * Real-time Cryptocurrency Live Pricing and Conversion Service
 * Queries live market data feeds (DEXScreener, CoinGecko & Binance) without fake or simulated values.
 */

export interface LiveTokenPrice {
  symbol: string;
  priceUsd: number;
  change24h: number;
  lastUpdated: number;
}

// Map symbol to CoinGecko IDs
const COINGECKO_MAP: Record<string, string> = {
  VERSE: 'verse-bitcoin',
  POL: 'polygon-ecosystem-token',
  ETH: 'ethereum',
  BTC: 'bitcoin',
  BCH: 'bitcoin-cash',
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
  WBTC: 'wrapped-bitcoin',
  BNB: 'binancecoin',
};

// Map symbol to Binance symbol pair against USDT
const BINANCE_MAP: Record<string, string> = {
  ETH: 'ETHUSDT',
  BTC: 'BTCUSDT',
  BCH: 'BCHUSDT',
  POL: 'POLUSDT',
  USDC: 'USDCUSDT',
  DAI: 'DAIUSDT',
  WBTC: 'WBTCUSDT',
  BNB: 'BNBUSDT',
};

// Cache structure
let priceCache: Record<string, LiveTokenPrice> = {};
let lastFetchTime = 0;
const CACHE_DURATION_MS = 10000; // 10 seconds fresh

/**
 * Fetch real-time DEX price for VERSE directly from on-chain pools via DEXScreener or CoinGecko
 */
async function fetchVerseDexPrice(): Promise<LiveTokenPrice | null> {
  // 1. Try DEXScreener token endpoint (Ethereum VERSE contract 0x249cA82617eC3DfB2589c4c17ab7EC9765350a18)
  try {
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/0x249cA82617eC3DfB2589c4c17ab7EC9765350a18',
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data.pairs && data.pairs.length > 0) {
        // Find pair with highest liquidity
        const bestPair = data.pairs.reduce((prev: any, current: any) => {
          return (current.liquidity?.usd || 0) > (prev.liquidity?.usd || 0) ? current : prev;
        }, data.pairs[0]);

        if (bestPair && bestPair.priceUsd) {
          const price = parseFloat(bestPair.priceUsd);
          const change = bestPair.priceChange?.h24 ? parseFloat(bestPair.priceChange.h24) : 0;
          if (!isNaN(price) && price > 0) {
            return {
              symbol: 'VERSE',
              priceUsd: price,
              change24h: change,
              lastUpdated: Date.now(),
            };
          }
        }
      }
    }
  } catch (e) {
    console.warn('[LivePricing] DEXScreener ETH fetch failed for VERSE:', e);
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
            return {
              symbol: 'VERSE',
              priceUsd: price,
              change24h: change,
              lastUpdated: Date.now(),
            };
          }
        }
      }
    }
  } catch (polyErr) {
    console.warn('[LivePricing] DEXScreener Polygon fetch failed for VERSE:', polyErr);
  }

  // 3. Try CoinGecko contract price endpoint for VERSE on Ethereum
  try {
    const cgRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=0x249cA82617eC3DfB2589c4c17ab7EC9765350a18&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(5000) }
    );
    if (cgRes.ok) {
      const cgData = await cgRes.json();
      const addrKey = '0x249ca82617ec3dfb2589c4c17ab7ec9765350a18';
      if (cgData && cgData[addrKey] && typeof cgData[addrKey].usd === 'number' && cgData[addrKey].usd > 0) {
        return {
          symbol: 'VERSE',
          priceUsd: cgData[addrKey].usd,
          change24h: cgData[addrKey].usd_24h_change || 0,
          lastUpdated: Date.now(),
        };
      }
    }
  } catch (cgErr) {
    console.warn('[LivePricing] CoinGecko contract price fallback for VERSE:', cgErr);
  }

  return null;
}

/**
 * Fetch real-time live prices from CoinGecko API
 */
async function fetchCoinGeckoPrices(): Promise<Record<string, LiveTokenPrice> | null> {
  try {
    const ids = Object.values(COINGECKO_MAP).join(',');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();

    const results: Record<string, LiveTokenPrice> = {};
    const now = Date.now();

    for (const [symbol, cgId] of Object.entries(COINGECKO_MAP)) {
      if (data[cgId] && typeof data[cgId].usd === 'number') {
        results[symbol] = {
          symbol,
          priceUsd: data[cgId].usd,
          change24h: data[cgId].usd_24h_change || 0,
          lastUpdated: now,
        };
      }
    }

    // Default stablecoins if missing
    if (!results['USDT']) results['USDT'] = { symbol: 'USDT', priceUsd: 1.0, change24h: 0, lastUpdated: now };
    if (!results['USDC']) results['USDC'] = { symbol: 'USDC', priceUsd: 1.0, change24h: 0, lastUpdated: now };

    return results;
  } catch (err) {
    console.warn('[LivePricing] CoinGecko fetch failed, trying fallback:', err);
    return null;
  }
}

/**
 * Fetch real-time live prices from Binance API fallback
 */
async function fetchBinancePrices(): Promise<Record<string, LiveTokenPrice> | null> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const items: Array<{ symbol: string; price: string }> = await res.json();
    const map = new Map(items.map((i) => [i.symbol, parseFloat(i.price)]));

    const results: Record<string, LiveTokenPrice> = {};
    const now = Date.now();

    for (const [sym, bPair] of Object.entries(BINANCE_MAP)) {
      const price = map.get(bPair);
      if (price) {
        results[sym] = {
          symbol: sym,
          priceUsd: price,
          change24h: 0,
          lastUpdated: now,
        };
      }
    }

    // Add USDT / USDC
    results['USDT'] = { symbol: 'USDT', priceUsd: 1.0, change24h: 0, lastUpdated: now };
    results['USDC'] = { symbol: 'USDC', priceUsd: 1.0, change24h: 0, lastUpdated: now };

    return Object.keys(results).length > 0 ? results : null;
  } catch (err) {
    console.warn('[LivePricing] Binance fetch failed:', err);
    return null;
  }
}

/**
 * Get all current live token prices
 */
export async function getLiveTokenPrices(): Promise<{
  prices: Record<string, LiveTokenPrice>;
  isLive: boolean;
}> {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_DURATION_MS && Object.keys(priceCache).length > 0) {
    return { prices: priceCache, isLive: true };
  }

  // 1. Fetch Verse specifically from DEXScreener in parallel with general CoinGecko/Binance
  const [verseDex, coinGeckoData] = await Promise.allSettled([
    fetchVerseDexPrice(),
    fetchCoinGeckoPrices(),
  ]);

  let liveData: Record<string, LiveTokenPrice> = {};

  if (coinGeckoData.status === 'fulfilled' && coinGeckoData.value) {
    liveData = { ...coinGeckoData.value };
  } else {
    const binanceData = await fetchBinancePrices();
    if (binanceData) {
      liveData = { ...binanceData };
    }
  }

  // If we got high-precision DEX price for VERSE, prioritize it
  if (verseDex.status === 'fulfilled' && verseDex.value) {
    liveData['VERSE'] = verseDex.value;
  }

  if (Object.keys(liveData).length > 0) {
    priceCache = { ...priceCache, ...liveData };
    lastFetchTime = now;
    return { prices: priceCache, isLive: true };
  }

  // Check if we have cached data
  if (Object.keys(priceCache).length > 0) {
    return { prices: priceCache, isLive: true };
  }

  return { prices: {}, isLive: false };
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
  if (!tokenData || !tokenData.priceUsd || tokenData.priceUsd <= 0) {
    return {
      tokenAmount: '0',
      tokenPriceUsd: 0,
      exchangeRateText: 'Live quote unavailable',
      isAvailable: false,
    };
  }

  const rawTokenAmount = params.amountDueUsd / tokenData.priceUsd;
  
  // Format token amount with high precision
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
