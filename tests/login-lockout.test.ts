import { describe, it, expect } from 'vitest';
import { getLoginTargetKey, familyTargetKey, validateLoginBody, TARGET_MAX_ATTEMPTS } from '@/app/api/utils/login-target';
import { checkIpLockout, recordFailedAttempt, resetFailedAttempts } from '@/app/api/utils/ip-lockout';
import * as ipLockoutRoute from '@/app/api/auth/ip-lockout/route';

describe('getLoginTargetKey', () => {
  it('gives the sysadmin login its own key', () => {
    expect(getLoginTargetKey({ adminPassword: 'x' })).toBe('target:admin');
    expect(getLoginTargetKey({ adminPassword: 'x', familySlug: 'smith' })).toBe('target:admin');
  });

  it('returns null for PIN logins (keyed later by resolved family)', () => {
    expect(getLoginTargetKey({ familySlug: 'smith', securityPin: '1' })).toBeNull();
    expect(getLoginTargetKey({})).toBeNull();
  });
});

describe('familyTargetKey', () => {
  it('keys by family id, so slug and no-slug logins to one family share a counter', () => {
    expect(familyTargetKey('fam-1')).toBe('target:family:fam-1');
  });

  it('falls back to a default key for legacy settings without a family', () => {
    expect(familyTargetKey(null)).toBe('target:family:default');
    expect(familyTargetKey(undefined)).toBe('target:family:default');
  });

  it('never produces a key that could collide with an IP', () => {
    expect(familyTargetKey('127.0.0.1')).toMatch(/^target:/);
  });
});

describe('validateLoginBody', () => {
  it('accepts string or missing fields', () => {
    expect(validateLoginBody({ familySlug: 'smith', securityPin: '123456' })).toBeNull();
    expect(validateLoginBody({ adminPassword: 'x', loginId: null })).toBeNull();
  });

  it('rejects non-string fields and non-object bodies', () => {
    expect(validateLoginBody({ familySlug: ['smith'] })).toMatch(/familySlug/);
    expect(validateLoginBody({ securityPin: 123456 })).toMatch(/securityPin/);
    expect(validateLoginBody(null)).not.toBeNull();
    expect(validateLoginBody([])).not.toBeNull();
  });
});

describe('recordFailedAttempt threshold', () => {
  it('locks after the default 3 attempts', () => {
    const key = 'test:default-threshold';
    recordFailedAttempt(key);
    recordFailedAttempt(key);
    expect(checkIpLockout(key).locked).toBe(false);
    expect(recordFailedAttempt(key).locked).toBe(true);
  });

  it('honours a custom threshold for target keys', () => {
    const key = 'test:target-threshold';
    for (let i = 1; i < TARGET_MAX_ATTEMPTS; i++) {
      expect(recordFailedAttempt(key, TARGET_MAX_ATTEMPTS).locked).toBe(false);
    }
    expect(recordFailedAttempt(key, TARGET_MAX_ATTEMPTS).locked).toBe(true);
    resetFailedAttempts(key);
    expect(checkIpLockout(key).locked).toBe(false);
  });
});

describe('/api/auth/ip-lockout', () => {
  it('is read-only: clients cannot record or clear failures', () => {
    expect(typeof ipLockoutRoute.GET).toBe('function');
    expect('POST' in ipLockoutRoute).toBe(false);
    expect('DELETE' in ipLockoutRoute).toBe(false);
  });
});
