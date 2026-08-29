// PayFlux Progressive Web App Service Worker
// Version: 1.0.0
const CACHE_NAME = 'payflux-static-v1.0.0';

// Core shell assets to precache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png'
];

// Domains and URL patterns that must NEVER be cached or intercepted
const BYPASS_PATTERNS = [
  'walletconnect',
  'relay.walletconnect',
  'pulse.walletconnect',
  'api.web3modal',
  'reown',
  'polygon-rpc.com',
  'etherscan.io',
  'polygonscan.com',
  'versescan.org',
  'api.binance.com',
  'aggregator-api.kyberswap.com',
  'kyberswap.com',
  'stats-api.dln.trade',
  'debridge.finance',
  'coingecko.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'firebase',
  'infura.io',
  'alchemy.com',
  'quicknode',
  '1rpc.io',
  'ankr.com',
  'drpc.org',
  'cloudflare-eth.com',
  '/api/',
  'chrome-extension:',
  'moz-extension:'
];

function shouldBypass(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  for (let i = 0; i < BYPASS_PATTERNS.length; i++) {
    if (lower.indexOf(BYPASS_PATTERNS[i]) !== -1) {
      return true;
    }
  }
  return false;
}

// 1. Install Event: Precache core shell assets and immediately skip waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS).catch((err) => {
          console.warn('[PayFlux SW] Precache partial error (ignored):', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean up stale caches and take control of all active clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Safe Network-First for Navigation (HTML) & Stale-While-Revalidate for Static Assets
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') {
    return;
  }

  const url = req.url;

  // Never intercept external APIs, RPCs, or WalletConnect traffic
  if (shouldBypass(url)) {
    return;
  }

  // Network-First for navigation / HTML documents to guarantee deployments are never stale
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/') || await caches.match('/index.html');
          if (cached) return cached;
          return new Response('PayFlux is offline. Please check your internet connection.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }

  // Stale-While-Revalidate for local static assets (JS, CSS, images, fonts)
  if (url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(req).then((cachedResponse) => {
        const fetchPromise = fetch(req)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }
});

// 4. Message Event: Allow web clients to trigger skipWaiting or force cache refresh
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
