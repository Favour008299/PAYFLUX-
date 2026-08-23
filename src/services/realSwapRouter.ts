/**
 * Unified Real On-Chain Swap Router
 * Re-exports the unified shared swap engine logic for backwards compatibility.
 */

export * from './sharedSwapEngine';
export { getUnifiedSwapQuote as getRealSwapQuote } from './sharedSwapEngine';
