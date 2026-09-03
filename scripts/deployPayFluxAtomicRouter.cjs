/**
 * PayFlux Atomic Router Deployment Script
 * 
 * Usage:
 *   PRIVATE_KEY="0x..." node scripts/deployPayFluxAtomicRouter.cjs
 * 
 * Deploying to: Polygon PoS Mainnet (Chain ID: 137)
 * Constructor Argument: _treasury = 0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD
 */

const fs = require('fs');
const { createWalletClient, createPublicClient, http, fallback, encodeDeployData } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { polygon } = require('viem/chains');

const TREASURY = '0x5545d62F1ca95fF7DfED4e938Fa908d5000FdecD';

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: Set PRIVATE_KEY environment variable to deploy.');
    console.log('Example: PRIVATE_KEY="0x..." node scripts/deployPayFluxAtomicRouter.cjs');
    process.exit(1);
  }

  const cleanKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(cleanKey);
  console.log('Deployer Account:', account.address);

  const publicClient = createPublicClient({
    chain: polygon,
    transport: fallback([
      http('https://polygon-bor-rpc.publicnode.com'),
      http('https://polygon.drpc.org'),
      http('https://1rpc.io/matic'),
    ]),
  });

  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: fallback([
      http('https://polygon-bor-rpc.publicnode.com'),
      http('https://polygon.drpc.org'),
      http('https://1rpc.io/matic'),
    ]),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log('Deployer Balance:', (Number(balance) / 1e18).toFixed(4), 'POL');

  if (balance < 50000000000000000n) { // 0.05 POL
    console.error('Insufficient POL balance to deploy. Minimum ~0.05 POL required for gas.');
    process.exit(1);
  }

  const contractArtifact = JSON.parse(fs.readFileSync('./contracts/PayFluxAtomicRouter.json', 'utf8'));

  const deployData = encodeDeployData({
    abi: contractArtifact.abi,
    bytecode: `0x${contractArtifact.bytecode}`,
    args: [TREASURY],
  });

  console.log('Broadcasting deployment transaction to Polygon PoS...');
  const txHash = await walletClient.sendTransaction({
    data: deployData,
  });

  console.log('Transaction Hash:', txHash);
  console.log('Waiting for block confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log('Deployment Confirmed in block:', receipt.blockNumber);
  console.log('\n=============================================');
  console.log('PAYFLUX ATOMIC ROUTER DEPLOYED AT:');
  console.log(receipt.contractAddress);
  console.log('=============================================\n');
  console.log('Set this address in your environment or Admin panel:');
  console.log(`VITE_PAYFLUX_ROUTER_ADDRESS="${receipt.contractAddress}"`);
}

main().catch(err => {
  console.error('Deployment Failed:', err);
  process.exit(1);
});
