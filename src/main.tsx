import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { wagmiAdapter, queryClient } from './config/web3';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

// Ensure BigInt values can be safely serialized anywhere in the app/libraries
if (typeof BigInt !== 'undefined' && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

// Clean up any legacy service workers if present
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().catch(() => {});
    }
  }).catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <AdminAuthProvider>
            <App />
          </AdminAuthProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  </StrictMode>,
);


