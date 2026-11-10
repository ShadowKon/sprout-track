import crypto from 'crypto';
import { hashPassword, verifyPassword } from './password-utils';

/**
 * Security PIN helpers.
 *
 * PINs are stored as PBKDF2 `salt:hash` strings (same format as password-utils).
 * Databases created before PIN hashing still hold plaintext PINs; those keep
 * working and are upgraded to a hash the first time they verify successfully.
 */

export interface PinCheck {
  /** The supplied PIN matches the stored value. */
  valid: boolean;
  /** The stored value is legacy plaintext and should be replaced with hashPin(pin). */
  needsRehash: boolean;
}

/** PINs are digits only, so a colon means the value is a salt:hash pair. */
export function isHashedPin(stored: string): boolean {
  return stored.includes(':');
}

export function hashPin(pin: string): Promise<string> {
  return hashPassword(pin);
}

/** Constant-time comparison for legacy plaintext PINs. */
function plaintextEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Check a supplied PIN against the stored value (hashed or legacy plaintext).
 */
export async function verifyPin(pin: string, stored: string | null | undefined): Promise<PinCheck> {
  if (!pin || !stored) {
    return { valid: false, needsRehash: false };
  }

  if (isHashedPin(stored)) {
    return { valid: await verifyPassword(pin, stored), needsRehash: false };
  }
  const valid = plaintextEquals(pin, stored);
  return { valid, needsRehash: valid };
}
