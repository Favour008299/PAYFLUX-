import { createPublicClient, http, fallback, formatUnits, getAddress } from 'viem';
import { polygon, mainnet } from 'viem/chains';

const polygonPublicClient = createPublicClient({
  chain: polygon,
  transport: fallback([
    http('https://polygon-rpc.com', { timeout: 8000 }),
    http('https://polygon-bor-rpc.publicnode.com', { timeout: 8000 }),
    http('https://1rpc.io/matic', { timeout: 8000 }),
    http('https://rpc.ankr.com/polygon', { timeout: 8000 }),
  ]),
});

const ethereumPublicClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http('https://cloudflare-eth.com', { timeout: 8000 }),
    http('https://eth.llamarpc.com', { timeout: 8000 }),
    http('https://1rpc.io/eth', { timeout: 8000 }),
    http('https://rpc.ankr.com/eth', { timeout: 8000 }),
  ]),
});

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface RealWalletBalances {
  // Polygon Assets
  polygon_VERSE: number;
  polygon_POL: number;
  polygon_USDT: number;
  polygon_USDC: number;
  polygon_DAI: number;
  polygon_WBTC: number;

  // Ethereum Assets
  ethereum_VERSE: number;
  ethereum_ETH: number;
  ethereum_USDT: number;
  ethereum_USDC: number;

  // Aggregate / Compatibility Map
  VERSE: number;
  POL: number;
  ETH: number;
  USDT: number;
  USDC: number;
  DAI: number;
  WBTC: number;
  BTC: number;
  BCH: number;

  // Token ID direct map
  byTokenId: Record<string, number>;
  byNetworkAndSymbol: Record<string, number>;

  lastUpdated: number;
  hasErrors?: boolean;
}

/**
 * Directly queries on-chain contracts and native balances for the connected wallet address
 * Returns the exact live balances from the blockchain.
 */
export async function fetchRealOnchainBalances(userAddress: string): Promise<RealWalletBalances> {
  const result: RealWalletBalances = {
    polygon_VERSE: 0,
    polygon_POL: 0,
    polygon_USDT: 0,
    polygon_USDC: 0,
    polygon_DAI: 0,
    polygon_WBTC: 0,
    ethereum_VERSE: 0,
    ethereum_ETH: 0,
    ethereum_USDT: 0,
    ethereum_USDC: 0,
    VERSE: 0,
    POL: 0,
    ETH: 0,
    USDT: 0,
    USDC: 0,
    DAI: 0,
    WBTC: 0,
    BTC: 0,
    BCH: 0,
    byTokenId: {},
    byNetworkAndSymbol: {},
    lastUpdated: Date.now(),
  };

  if (!userAddress || !userAddress.startsWith('0x') || userAddress.length !== 42) {
    return result;
  }

  let formattedAddr: `0x${string}`;
  try {
    formattedAddr = getAddress(userAddress);
  } catch (e) {
    console.error('Invalid wallet address for balance check:', userAddress);
    return result;
  }

  // Run Polygon and Ethereum balance queries in parallel with individual safe guards
  await Promise.allSettled([
    // 1. Native POL on Polygon
    (async () => {
      try {
        const rawPol = await polygonPublicClient.getBalance({ address: formattedAddr });
        const val = parseFloat(formatUnits(rawPol, 18));
        result.polygon_POL = val;
        result.POL = val;
        result.byTokenId['pol-polygon'] = val;
        result.byNetworkAndSymbol['polygon:POL'] = val;
      } catch (err) {
        console.warn('Notice: Error querying native POL balance:', err);
      }
    })(),

    // 2. VERSE on Polygon (0xc708D6F2153933DAA50B2D0758955Be0A93A8FEc, 18 decimals)
    (async () => {
      try {
        const rawVersePolygon = await (polygonPublicClient as any).readContract({
          address: '0xc708D6F2153933DAA50B2D0758955Be0A93A8FEc',
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [formattedAddr],
        });
        const val = parseFloat(formatUnits(rawVersePolygon as bigint, 18));
        result.polygon_VERSE = val;
        result.byTokenId['verse-polygon'] = val;
        result.byNetworkAndSymbol['polygon:VERSE'] = val;
      } catch (err) {
        console.warn('Notice: Error querying VERSE on Polygon:', err);
      }
    })(),

    // 3. USDT on Polygon (0xc2132D05D31c914a87C6611C10748AEb04B58e8F, 6 decimals)
    (async () => {
      try {
        const rawUsdtPolygon = await (polygonPublicClient as any).readContract({
          address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [formattedAddr],
        });
        const val = parseFloat(formatUnits(rawUsdtPolygon as bigint, 6));
        result.polygon_USDT = val;
        result.byTokenId['usdt-polygon'] = val;
        result.byNetworkAndSymbol['polygon:USDT'] = val;
      } catch (err) {
        console.warn('Notice: Error querying USDT on Polygon:', err);
      }
    })(),

    // 4. USDC on Polygon (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359, 6 decimals)
    (async () => {
      try {
        const rawUsdcPolygon = await (polygonPublicClient as any).readContract({
          address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [formattedAddr],
        });
        const val = parseFloat(formatUnits(rawUsdcPolygon as bigint, 6));
        result.polygon_USDC = val;
        result.byTokenId['usdc-polygon'] = val;
        result.byNetworkAndSymbol['polygon:USDC'] = val;
      } catch (err) {
        console.warn('Notice: Error querying USDC on Polygon:', err);
      }
    })(),

    // 5. DAI on Polygon (0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063, 18 decimals)
    (async () => {
      try {
        const rawDai = await (polygonPublicClient as any).readContract({
          address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [formattedAddr],
        });
        const val = parseFloat(formatUnits(rawDai as bigint, 18));
        result.polygon_DAI = val;
        result.DAI = val;
        result.byTokenId['dai-polygon'] = val;
        result.byNetworkAndSymbol['polygon:DAI'] = val;
      } catch (err) {
        console.warn('Notice: Error querying DAI on Polygon:', err);
      }
    })(),

    // 6. WBTC on Polygon (0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6, 8 decimals)
    (async () => {
      try {
        const rawWbtc = await (polygonPublicClient as any).readContract({
          address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [formattedAddr],
        });
        const val = parseFloat(formatUnits(rawWbtc as bigint, 8));
        result.polygon_WBTC = val;
        result.WBTC = val;
        result.byTokenId['wbtc-polygon'] = val;
        result.byNetworkAndSymbol['polygon:WBTC'] = val;
      } catch (err) {
        console.warn('Notice: Error querying WBTC on Polygon:', err);
      }
    })(),

    // 7. VERSE on Ethereum (0x249cA82617eC3DfB2589c4c17ab7EC9765350a18, 18 decimals)
    (async () => {
      try {
        const rawVerseEth = await (ethereumPublicClient as any).readContract({
          address: '0x249cA82617eC3DfB2589c4c17ab7EC9765350a18',
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [formattedAddr],
        });
        const val = parseFloat(formatUnits(rawVerseEth as bigint, 18));
        result.ethereum_VERSE = val;
        result.byTokenId['verse-ethereum'] = val;
        result.byNetworkAndSymbol['ethereum:VERSE'] = val;
      } catch (err) {
        console.warn('Notice: Error querying VERSE on Ethereum:', err);
      }
    })(),

    // 8. Native ETH on Ethereum
    (async () => {
      try {
        const rawEth = await ethereumPublicClient.getBalance({ address: formattedAddr });
        const val = parseFloat(formatUnits(rawEth, 18));
        result.ethereum_ETH = val;
        result.ETH = val;
        result.byTokenId['eth-ethereum'] = val;
        result.byNetworkAndSymbol['ethereum:ETH'] = val;
      } catch (err) {
        console.warn('Notice: Error querying native ETH on Ethereum:', err);
      }
    })(),

    // 9. USDT on Ethereum (0xdAC17F958D2ee523a2206206994597C13D831ec7, 6 decimals)
    (async () => {
      try {
        const rawUsdtEth = await (ethereumPublicClient as any).readContract({
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [formattedAddr],
        });
        const val = parseFloat(formatUnits(rawUsdtEth as bigint, 6));
        result.ethereum_USDT = val;
        result.byTokenId['usdt-ethereum'] = val;
        result.byNetworkAndSymbol['ethereum:USDT'] = val;
      } catch (err) {
        console.warn('Notice: Error querying USDT on Ethereum:', err);
      }
    })(),

    // 10. USDC on Ethereum (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, 6 decimals)
    (async () => {
      try {
        const rawUsdcEth = await (ethereumPublicClient as any).readContract({
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [formattedAddr],
        });
        const val = parseFloat(formatUnits(rawUsdcEth as bigint, 6));
        result.ethereum_USDC = val;
        result.byTokenId['usdc-ethereum'] = val;
        result.byNetworkAndSymbol['ethereum:USDC'] = val;
      } catch (err) {
        console.warn('Notice: Error querying USDC on Ethereum:', err);
      }
    })(),
  ]);

  // Combined sums
  result.VERSE = result.polygon_VERSE + result.ethereum_VERSE;
  result.USDT = result.polygon_USDT + result.ethereum_USDT;
  result.USDC = result.polygon_USDC + result.ethereum_USDC;

  return result;
}
