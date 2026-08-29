import { NetworkType } from '../types';

export const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
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
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

export interface TokenContractInfo {
  address: `0x${string}`;
  decimals: number;
  isNative?: boolean;
}

export const TOKEN_CONTRACTS: Record<number, Record<string, TokenContractInfo>> = {
  // Polygon Mainnet (137)
  137: {
    POL: { address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    VERSE: { address: '0xc708D6F2153933DAA50B2D0758955Be0A93A8FEc', decimals: 18 },
    USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    DAI: { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
    WBTC: { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8 },
  },
  // Ethereum Mainnet (1)
  1: {
    ETH: { address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    VERSE: { address: '0x249cA82617eC3DfB2589c4c17ab7EC9765350a18', decimals: 18 },
    USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    DAI: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  },
  // BNB Chain (56)
  56: {
    BNB: { address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  },
};

export function getExplorerTxUrl(network: NetworkType | string, txHash: string): string {
  switch (network) {
    case 'polygon':
      return `https://polygonscan.com/tx/${txHash}`;
    case 'ethereum':
      return `https://etherscan.io/tx/${txHash}`;
    case 'bnb':
      return `https://bscscan.com/tx/${txHash}`;
    case 'avalanche':
      return `https://snowtrace.io/tx/${txHash}`;
    case 'bitcoincash':
      return `https://blockchair.com/bitcoin-cash/transaction/${txHash}`;
    case 'bitcoin':
      return `https://mempool.space/tx/${txHash}`;
    default:
      return `https://polygonscan.com/tx/${txHash}`;
  }
}

export function getExplorerAddressUrl(network: NetworkType | string, address: string): string {
  switch (network) {
    case 'polygon':
      return `https://polygonscan.com/address/${address}`;
    case 'ethereum':
      return `https://etherscan.io/address/${address}`;
    case 'bnb':
      return `https://bscscan.com/address/${address}`;
    default:
      return `https://polygonscan.com/address/${address}`;
  }
}
