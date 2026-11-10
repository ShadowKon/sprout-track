/**
 * Per-target login lockout.
 *
 * The IP lockout keys on X-Forwarded-For, which Next.js passes through
 * unchanged when the client sends it, so an attacker can rotate fake IPs.
 * A second counter keyed on *what is being logged into* can't be dodged that
 * way: every guess against the same family/caretaker lands on the same key.
 *
 * Keys share the in-memory store in ip-lockout.ts with IP keys, so they're
 * prefixed (e.g. "target:...") to never collide with an address.
 */

/**
 * Failures allowed against one target before it locks for LOCKOUT_DURATION.
 * Higher than the per-IP limit (3) because several family members' devices
 * share one target, and a lockout here locks out the whole household.
 */
export const TARGET_MAX_ATTEMPTS = 10;

export interface LoginRequestBody {
  loginId?: string;
  securityPin?: string;
  familySlug?: string;
  adminPassword?: string;
}

/**
 * Return the lockout key for this login attempt, or null to skip
 * per-target counting.
 */
export function getLoginTargetKey(body: LoginRequestBody): string | null {
  if (body.adminPassword) {
    return 'target:admin';
  }
  const slug = (body.familySlug || 'default').trim().toLowerCase() || 'default';
  return `target:family:${slug}`;
}
