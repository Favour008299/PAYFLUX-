import { appKit } from '../config/web3';

export interface AppKitOpenOptions {
  view?: 'Connect' | 'Account' | 'AllWallets' | 'Networks' | 'WhatIsAWallet';
}

/**
 * Universal safe hook for AppKit modal interaction without relying on internal React controller dispatchers
 */
export function useAppKit() {
  return {
    open: async (options?: AppKitOpenOptions) => {
      try {
        if (appKit && typeof appKit.open === 'function') {
          return await appKit.open(options);
        }
      } catch (e) {
        console.warn('[PayFlux AppKit] open error:', e);
      }
    },
    close: async () => {
      try {
        if (appKit && typeof appKit.close === 'function') {
          return await appKit.close();
        }
      } catch (_) {}
    },
  };
}

export function openAppKitModal(view: 'Connect' | 'Account' | 'AllWallets' | 'Networks' = 'Connect') {
  try {
    if (appKit && typeof appKit.open === 'function') {
      return appKit.open({ view });
    }
  } catch (e) {
    console.warn('[PayFlux AppKit] open error:', e);
  }
}

export function closeAppKitModal() {
  try {
    if (appKit && typeof appKit.close === 'function') {
      return appKit.close();
    }
  } catch (_) {}
}

export default useAppKit;
