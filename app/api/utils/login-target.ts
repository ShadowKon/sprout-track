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

/** Returns an error message when a login field is present but not a string. */
export function validateLoginBody(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Invalid request body';
  for (const field of ['loginId', 'securityPin', 'familySlug', 'adminPassword'] as const) {
    const value = (body as Record<string, unknown>)[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${field} must be a string`;
    }
  }
  return null;
}

/**
 * Lockout key known before any database lookup: only the sysadmin login.
 * PIN logins are keyed by the family they resolve to (familyTargetKey), so a
 * request can't dodge its family's counter by omitting or varying the slug.
 */
export function getLoginTargetKey(body: LoginRequestBody): string | null {
  return body.adminPassword ? 'target:admin' : null;
}

/** Lockout key for a PIN login, from the family the PIN is checked against. */
export function familyTargetKey(familyId: string | null | undefined): string {
  return `target:family:${familyId || 'default'}`;
}
