/**
 * PayFlux Native Biometric Authentication Service
 * Uses standard W3C Web Authentication API (WebAuthn / PublicKeyCredential)
 * to interface directly with Android BiometricPrompt and platform authenticators.
 *
 * CRITICAL SECURITY GUARANTEES:
 * 1. NEVER collects, stores, transmits, or accesses fingerprint or biometric data.
 *    The hardware/OS handles biometrics entirely at the platform level.
 * 2. This is an app-access privacy lock only. It does NOT replace or intercept
 *    crypto transaction signatures in the connected wallet.
 */

const CREDENTIAL_STORAGE_KEY = 'payflux_biometric_credential_id';

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

export interface BiometricAvailabilityResult {
  available: boolean;
  hasEnrolledBiometrics: boolean;
  error?: string;
}

/**
 * Checks if the device and browser support native biometric authentication (fingerprint/face/screen lock)
 */
export async function checkBiometricAvailability(): Promise<BiometricAvailabilityResult> {
  if (typeof window === 'undefined') {
    return {
      available: false,
      hasEnrolledBiometrics: false,
      error: 'Device environment not available.',
    };
  }

  if (!window.PublicKeyCredential || !navigator.credentials) {
    return {
      available: false,
      hasEnrolledBiometrics: false,
      error:
        'Biometric authentication is not supported by this browser. Please use Chrome on Android or a WebAuthn-enabled browser.',
    };
  }

  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      const isPlatformAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!isPlatformAvailable) {
        return {
          available: false,
          hasEnrolledBiometrics: false,
          error:
            'No biometric authentication hardware is available or no fingerprint is enrolled on this device. Please configure fingerprint or device security in your Android settings first.',
        };
      }
    }

    return {
      available: true,
      hasEnrolledBiometrics: true,
    };
  } catch (err: any) {
    console.warn('[BiometricAuthService] Availability check warning:', err);
    return {
      available: false,
      hasEnrolledBiometrics: false,
      error:
        'Could not verify biometric support. Please ensure fingerprint authentication is enabled in your device settings.',
    };
  }
}

/**
 * Registers biometric authentication on the device.
 * Triggers native Android BiometricPrompt (fingerprint/face sensor).
 * Does not store or access any raw biometric data.
 */
export async function registerBiometric(rpName = 'PayFlux'): Promise<{ success: boolean; error?: string }> {
  const check = await checkBiometricAvailability();
  if (!check.available) {
    return {
      success: false,
      error:
        check.error ||
        'Biometric authentication is not supported or no fingerprint is enrolled on this device. Please configure biometric security in your Android settings first.',
    };
  }

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
          authenticatorAttachment: 'platform', // Native device platform authenticator (fingerprint/biometrics)
          userVerification: 'required', // Mandates fingerprint / biometric verification
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

    if (err?.name === 'NotSupportedError' || err?.name === 'InvalidStateError') {
      return {
        success: false,
        error:
          'Biometric authentication must be configured on your device first. Please set up fingerprint or screen lock in Android settings.',
      };
    }

    return {
      success: false,
      error:
        err?.message ||
        'Failed to activate biometric lock. Please ensure your device supports fingerprint authentication.',
    };
  }
}

/**
 * Authenticates the user with native Android biometrics (fingerprint / face / device lock fallback).
 * Returns true if the device confirms the user's identity.
 */
export async function authenticateBiometric(): Promise<{ success: boolean; error?: string }> {
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

    // If existing credential ID had an issue or was wiped, try a fresh platform assertion
    if (err?.name === 'InvalidStateError' || err?.name === 'NotAllowedError') {
      // If user explicitly cancelled
      if (err?.message?.includes('cancel') || err?.name === 'NotAllowedError') {
        return {
          success: false,
          error: 'Biometric authentication was cancelled. Touch the fingerprint sensor to unlock PayFlux.',
        };
      }
    }

    return {
      success: false,
      error: err?.message || 'Biometric authentication failed. Please try again.',
    };
  }
}

/**
 * Remove stored credential ID on toggle disable
 */
export function clearBiometricCredential(): void {
  try {
    localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
  } catch (_) {}
}
