import { describe, it, expect } from 'vitest';
import { getLoginTargetKey, TARGET_MAX_ATTEMPTS } from '@/app/api/utils/login-target';
import { checkIpLockout, recordFailedAttempt, resetFailedAttempts } from '@/app/api/utils/ip-lockout';
import * as ipLockoutRoute from '@/app/api/auth/ip-lockout/route';

describe('getLoginTargetKey', () => {
  it('gives the sysadmin login its own key', () => {
    expect(getLoginTargetKey({ adminPassword: 'x' })).toBe('target:admin');
    expect(getLoginTargetKey({ adminPassword: 'x', familySlug: 'smith' })).toBe('target:admin');
  });

  it('keys PIN logins per family, ignoring loginId', () => {
    expect(getLoginTargetKey({ familySlug: 'smith', securityPin: '1' })).toBe('target:family:smith');
    expect(getLoginTargetKey({ familySlug: 'smith', loginId: '01' }))
      .toBe(getLoginTargetKey({ familySlug: 'smith', loginId: '99' }));
  });

  it('normalizes the slug so case/whitespace variants share a counter', () => {
    expect(getLoginTargetKey({ familySlug: '  Smith ' })).toBe('target:family:smith');
  });

  it('falls back to a default key when the slug is missing or blank', () => {
    expect(getLoginTargetKey({})).toBe('target:family:default');
    expect(getLoginTargetKey({ familySlug: '' })).toBe('target:family:default');
    expect(getLoginTargetKey({ familySlug: '   ' })).toBe('target:family:default');
  });

  it('never produces a key that could collide with an IP', () => {
    expect(getLoginTargetKey({ familySlug: '127.0.0.1' })).toMatch(/^target:/);
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
