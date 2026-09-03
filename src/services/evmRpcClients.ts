import { createPublicClient, http, fallback } from 'viem';
import { polygon, mainnet } from 'viem/chains';

export const polygonRpcClient = createPublicClient({
  chain: polygon,
  transport: fallback([
    http('https://polygon-bor-rpc.publicnode.com'),
    http('https://polygon.drpc.org'),
    http('https://1rpc.io/matic'),
    http('https://polygon.gateway.tenderly.co'),
  ]),
});

export const ethereumRpcClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http('https://ethereum-rpc.publicnode.com'),
    http('https://eth.drpc.org'),
    http('https://1rpc.io/eth'),
  ]),
});
