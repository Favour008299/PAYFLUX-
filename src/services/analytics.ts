/**
 * PayFlux Analytics Tracking Service (analytics.vgdh.io / Plausible compatible)
 * Handles automatic virtual pageview tracking for SPA tab transitions and custom crypto event telemetry.
 */

declare global {
  interface Window {
    plausible?: {
      (...args: any[]): void;
      q?: any[];
    };
  }
}

const ANALYTICS_DOMAIN = 'payflux-orcin.vercel.app';
const ANALYTICS_ENDPOINT = 'https://analytics.vgdh.io/api/event';

// Ensure the queue function is ready
if (typeof window !== 'undefined') {
  window.plausible =
    window.plausible ||
    function () {
      (window.plausible!.q = window.plausible!.q || []).push(arguments);
    };
}

/**
 * Sends an analytics payload directly to the vgdh.io endpoint
 * to guarantee tracking across all environments and preview domains.
 */
async function sendEventPayload(name: string, path: string = '', props?: Record<string, any>) {
  if (typeof window === 'undefined') return;

  const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : window.location.pathname;
  const targetUrl = `https://${ANALYTICS_DOMAIN}${normalizedPath}`;

  const payload: Record<string, any> = {
    name,
    url: targetUrl,
    domain: ANALYTICS_DOMAIN,
  };

  if (props && Object.keys(props).length > 0) {
    payload.props = props;
  }

  try {
    // 1. Trigger via standard window.plausible function
    if (typeof window.plausible === 'function') {
      if (name === 'pageview') {
        window.plausible('pageview', { u: targetUrl, props });
      } else {
        window.plausible(name, { props });
      }
    }

    // 2. Direct HTTP POST to analytics.vgdh.io/api/event
    const bodyStr = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([bodyStr], { type: 'application/json' });
      navigator.sendBeacon(ANALYTICS_ENDPOINT, blob);
    } else if (window.fetch) {
      window
        .fetch(ANALYTICS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          mode: 'cors',
          credentials: 'omit',
        })
        .catch(() => {});
    }
  } catch (err) {
    // Silent fail so analytics never interrupts UI
    console.debug('[Analytics] Event dispatch notice:', err);
  }
}

/**
 * Track a virtual page view (e.g. tab switches: /swap, /pay, /merchant, /portfolio, /admin)
 */
export function trackPageView(path: string, props?: Record<string, any>) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  sendEventPayload('pageview', cleanPath, {
    tab: cleanPath.replace('/', '') || 'home',
    ...props,
  });
}

/**
 * Track user events and conversions (e.g. wallet connect, swap complete, invoice paid)
 */
export function trackEvent(eventName: string, props?: Record<string, any>) {
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  sendEventPayload(eventName, currentPath, props);
}

// Export default object
export const analytics = {
  pageview: trackPageView,
  event: trackEvent,
};
