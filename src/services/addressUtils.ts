import { getAddress } from 'viem';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function safeGetAddress(address?: string | null): `0x${string}` {
  if (!address) return ZERO_ADDRESS;
  try {
    return getAddress(address.trim());
  } catch {
    if (address.startsWith('0x') && address.length === 42) {
      return address.toLowerCase() as `0x${string}`;
    }
    return ZERO_ADDRESS;
  }
}
