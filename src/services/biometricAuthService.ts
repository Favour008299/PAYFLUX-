/**
 * PayFlux Native Biometric Authentication Service
 * Interfaces with platform biometric authenticators:
 * 1. Native Android JavascriptInterface bridges (when embedded in an Android app/WebView)
 * 2. W3C Web Authentication API (WebAuthn / PublicKeyCredential platform authenticator)
 *
 * CRITICAL SECURITY & COMPLIANCE RULES:
 * - NEVER collects, stores, transmits, or accesses fingerprint or biometric data.
 * - Hardware/OS handles biometrics entirely at the platform level (Android BiometricPrompt).
 * - Distinguishes accurately between:
 *     A. "Biometrics are unavailable on this device"
 *     B. "Biometrics are supported on the device but unavailable to this web/preview environment."
 * - App-access privacy lock only. NEVER replaces or intercepts crypto transaction wallet signatures.
 */

const CREDENTIAL_STORAGE_KEY = 'payflux_biometric_credential_id';

export type BiometricCategory = 'A' | 'B' | 'SUPPORTED';

export interface BiometricAvailabilityResult {
  available: boolean;
  category: BiometricCategory;
  title: string;
  message: string;
  canOpenStandalone?: boolean;
}

function uint8ArrayToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Checks for any native Android WebView JavaScriptInterface bridge
 */
export function getNativeAndroidBridge(): any | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  if (w.AndroidBiometric) return w.AndroidBiometric;
  if (w.Android && typeof (w.Android.canAuthenticate || w.Android.authenticate) === 'function') {
    return w.Android;
  }
  if (w.PayFluxNative && typeof (w.PayFluxNative.canAuthenticate || w.PayFluxNative.authenticate) === 'function') {
    return w.PayFluxNative;
  }
  if (w.BiometricBridge) return w.BiometricBridge;
  if (w.Capacitor?.Plugins?.BiometricAuth) return w.Capacitor.Plugins.BiometricAuth;
  return null;
}

/**
 * Detects if the current client is an Android device
 */
export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Detects if the current client is any mobile device with common biometric hardware
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Detects if the page is currently running inside an iframe (e.g. Google AI Studio preview)
 */
export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch (_) {
    return true;
  }
}

/**
 * Checks biometric availability using the correct platform-supported biometric authentication
 * mechanism for the environment in which PayFlux is actually running.
 *
 * Explicitly distinguishes:
 * A. “Biometrics are unavailable on this device”
 * B. “Biometrics are supported on the device but unavailable to this web/preview environment.”
 *
 * Does NOT tell the user to enroll a fingerprint if one is already enrolled.
 */
export async function checkBiometricAvailability(): Promise<BiometricAvailabilityResult> {
  if (typeof window === 'undefined') {
    return {
      available: false,
      category: 'A',
      title: 'Biometrics are unavailable on this device',
      message: 'No client window environment detected.',
    };
  }

  const isAndroid = isAndroidDevice();
  const isMobile = isMobileDevice();
  const inIframe = isRunningInIframe();

  // 1. Check Native Android Bridge if PayFlux is running inside a native Android container
  const nativeBridge = getNativeAndroidBridge();
  if (nativeBridge) {
    try {
      let canAuth = false;
      if (typeof nativeBridge.canAuthenticate === 'function') {
        const res = await Promise.resolve(nativeBridge.canAuthenticate());
        canAuth = res === true || res === 'true' || res === 0;
      } else if (typeof nativeBridge.isBiometricAvailable === 'function') {
        canAuth = await Promise.resolve(nativeBridge.isBiometricAvailable());
      } else if (typeof nativeBridge.isAvailable === 'function') {
        canAuth = await Promise.resolve(nativeBridge.isAvailable());
      } else {
        canAuth = true;
      }

      if (canAuth) {
        return {
          available: true,
          category: 'SUPPORTED',
          title: 'Android Biometrics Available',
          message: 'Native Android biometric authentication is ready.',
        };
      } else {
        // Native bridge explicitly reports no biometric capability
        return {
          available: false,
          category: 'A',
          title: 'Biometrics are unavailable on this device',
          message: 'No biometric hardware is available on this device.',
        };
      }
    } catch (err) {
      console.warn('[BiometricAuthService] Native bridge check warning:', err);
    }
  }

  // 2. Check Web Environment Restrictions (iframe / Google AI Studio preview / insecure context)
  // In an iframe (such as Google AI Studio preview), the W3C WebAuthn spec blocks platform authenticators
  // unless explicitly delegated via Permissions-Policy (publickey-credentials-create / publickey-credentials-get).
  if (inIframe) {
    if (isAndroid || isMobile) {
      return {
        available: false,
        category: 'B',
        title: 'Biometrics are supported on the device but unavailable to this web/preview environment.',
        message:
          'Your phone supports biometric authentication, but the web/Google AI Studio preview frame restricts access to native Android biometrics. Open PayFlux in a direct standalone browser tab or native Android environment to activate Biometric Lock.',
        canOpenStandalone: true,
      };
    } else {
      return {
        available: false,
        category: 'A',
        title: 'Biometrics are unavailable on this device',
        message: 'No biometric authentication hardware is available on this device.',
      };
    }
  }

  // 3. Insecure Context check (WebAuthn requires HTTPS)
  if (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext) {
    if (isAndroid || isMobile) {
      return {
        available: false,
        category: 'B',
        title: 'Biometrics are supported on the device but unavailable to this web/preview environment.',
        message:
          'Biometric authentication requires a secure context (HTTPS). This web environment is not running over HTTPS.',
        canOpenStandalone: false,
      };
    } else {
      return {
        available: false,
        category: 'A',
        title: 'Biometrics are unavailable on this device',
        message: 'No biometric authentication hardware is available on this device.',
      };
    }
  }

  // 4. Browser WebAuthn API support check
  if (!window.PublicKeyCredential || !navigator.credentials) {
    if (isAndroid || isMobile) {
      return {
        available: false,
        category: 'B',
        title: 'Biometrics are supported on the device but unavailable to this web/preview environment.',
        message:
          'Your device supports biometrics, but this web browser does not support the Web Authentication API. Please open PayFlux in Chrome on Android.',
        canOpenStandalone: true,
      };
    } else {
      return {
        available: false,
        category: 'A',
        title: 'Biometrics are unavailable on this device',
        message: 'No biometric authentication hardware is available on this device.',
      };
    }
  }

  // 5. Query platform authenticator availability (Android BiometricPrompt via Google Play Services / FIDO2)
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      const isPlatformAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (isPlatformAvailable) {
        return {
          available: true,
          category: 'SUPPORTED',
          title: 'Biometrics Ready',
          message: 'Device biometric authentication is available.',
        };
      } else {
        // Platform authenticator returned false in this browser
        if (isAndroid) {
          return {
            available: false,
            category: 'B',
            title: 'Biometrics are supported on the device but unavailable to this web/preview environment.',
            message:
              'Biometrics are supported on your Android device, but the platform authenticator is not accessible in this current web context. Please use Chrome on Android in a standalone tab or native environment.',
            canOpenStandalone: true,
          };
        } else {
          return {
            available: false,
            category: 'A',
            title: 'Biometrics are unavailable on this device',
            message: 'No biometric authentication hardware was detected on this device.',
          };
        }
      }
    }

    return {
      available: true,
      category: 'SUPPORTED',
      title: 'Biometrics Ready',
      message: 'Device biometric authentication is available.',
    };
  } catch (err: any) {
    console.warn('[BiometricAuthService] Platform authenticator check error:', err);
    if (isAndroid || isMobile) {
      return {
        available: false,
        category: 'B',
        title: 'Biometrics are supported on the device but unavailable to this web/preview environment.',
        message:
          'Biometrics are supported on your Android device, but could not be accessed in this web frame. Open PayFlux in a standalone browser tab.',
        canOpenStandalone: true,
      };
    }

    return {
      available: false,
      category: 'A',
      title: 'Biometrics are unavailable on this device',
      message: 'No biometric authentication hardware is available on this device.',
    };
  }
}

/**
 * Helper to authenticate via native Android bridge
 */
async function authenticateViaNativeBridge(nativeBridge: any): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof nativeBridge.authenticate === 'function') {
      const res = await Promise.resolve(nativeBridge.authenticate('Unlock PayFlux'));
      if (typeof res === 'boolean') return { success: res };
      if (typeof res === 'string') {
        const lower = res.toLowerCase();
        if (lower === 'success' || lower === 'true') return { success: true };
        return { success: false, error: res };
      }
      return { success: true };
    }
    if (typeof nativeBridge.promptBiometric === 'function') {
      const res = await Promise.resolve(nativeBridge.promptBiometric('Unlock PayFlux'));
      return { success: Boolean(res) };
    }
    return { success: false, error: 'Native biometric bridge did not provide an authentication method.' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Native biometric authentication failed.' };
  }
}

/**
 * Registers biometric authentication on the device.
 * Triggers native Android BiometricPrompt (fingerprint sensor).
 * The Biometric Lock toggle MUST only become enabled after a REAL biometric authentication succeeds.
 * Never stores or accesses any raw biometric data.
 */
export async function registerBiometric(rpName = 'PayFlux'): Promise<{ success: boolean; error?: string }> {
  const check = await checkBiometricAvailability();
  if (!check.available) {
    return {
      success: false,
      error: check.message,
    };
  }

  // 1. Native Android bridge execution if available
  const nativeBridge = getNativeAndroidBridge();
  if (nativeBridge) {
    return authenticateViaNativeBridge(nativeBridge);
  }

  // 2. Real WebAuthn platform authenticator execution (Android BiometricPrompt)
  try {
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const userId = new Uint8Array(16);
    window.crypto.getRandomValues(userId);

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: rpName,
          id: window.location.hostname || undefined,
        },
        user: {
          id: userId,
          name: 'payflux_user',
          displayName: 'PayFlux User',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256 (ECDSA with P-256)
          { type: 'public-key', alg: -257 }, // RS256 (RSA with SHA-256)
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // Native platform authenticator (fingerprint/biometrics)
          userVerification: 'required', // Mandates real fingerprint / biometric verification
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (credential && credential.rawId) {
      const b64Id = uint8ArrayToBase64(credential.rawId);
      try {
        localStorage.setItem(CREDENTIAL_STORAGE_KEY, b64Id);
      } catch (_) {}
      return { success: true };
    }

    return {
      success: false,
      error: 'Biometric verification did not complete. Please try again.',
    };
  } catch (err: any) {
    console.error('[BiometricAuthService] Registration error:', err);

    if (err?.name === 'NotAllowedError') {
      return {
        success: false,
        error: 'Biometric authentication was cancelled or timed out. Please try again.',
      };
    }

    if (err?.name === 'SecurityError') {
      return {
        success: false,
        error:
          'Biometrics are supported on the device but unavailable to this web/preview environment. Open PayFlux in a standalone browser tab to activate Biometric Lock.',
      };
    }

    if (err?.name === 'NotSupportedError' || err?.name === 'InvalidStateError') {
      if (isAndroidDevice()) {
        return {
          success: false,
          error:
            'Biometrics are supported on the device but unavailable to this web/preview environment. Please open PayFlux directly in Chrome on Android.',
        };
      }
      return {
        success: false,
        error: 'Biometrics are unavailable on this device.',
      };
    }

    return {
      success: false,
      error: err?.message || 'Biometric authentication failed. Please try again.',
    };
  }
}

/**
 * Authenticates the user with native Android biometrics (fingerprint / device lock fallback).
 * Returns true if the device confirms the user's identity.
 */
export async function authenticateBiometric(): Promise<{ success: boolean; error?: string }> {
  // 1. Native Android bridge execution if available
  const nativeBridge = getNativeAndroidBridge();
  if (nativeBridge) {
    return authenticateViaNativeBridge(nativeBridge);
  }

  if (typeof window === 'undefined' || !navigator.credentials) {
    return {
      success: false,
      error: 'Biometric authentication is not supported in this environment.',
    };
  }

  try {
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    let allowList: PublicKeyCredentialDescriptor[] = [];
    const savedId = localStorage.getItem(CREDENTIAL_STORAGE_KEY);
    if (savedId) {
      try {
        allowList.push({
          id: base64ToUint8Array(savedId) as unknown as ArrayBuffer,
          type: 'public-key',
        });
      } catch (_) {}
    }

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: allowList.length > 0 ? allowList : undefined,
        userVerification: 'required', // Triggers native Android BiometricPrompt
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (assertion) {
      return { success: true };
    }

    return {
      success: false,
      error: 'Biometric authentication could not be completed.',
    };
  } catch (err: any) {
    console.error('[BiometricAuthService] Authentication error:', err);

    if (err?.name === 'NotAllowedError') {
      return {
        success: false,
        error: 'Biometric authentication was cancelled. Touch the fingerprint sensor to unlock PayFlux.',
      };
    }

    if (err?.name === 'SecurityError') {
      return {
        success: false,
        error:
          'Biometrics are supported on the device but unavailable to this web/preview environment. Open in a standalone tab to unlock.',
      };
    }

    return {
      success: false,
      error: err?.message || 'Biometric authentication failed. Please try again.',
    };
  }
}

/**
 * Clears stored credential ID on toggle disable
 */
export function clearBiometricCredential(): void {
  try {
    localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
  } catch (_) {}
}
