import { describe, it, expect } from 'vitest';
import { decideInitialRestore, grantFollowUp, hasFollowUpGrant, InitialRestoreState } from '@/app/api/utils/initial-setup-guard';
import type { AuthResult } from '@/app/api/utils/auth';

const fresh: InitialRestoreState = {
  isSysAdmin: false,
  caretakerRole: 'ADMIN',
  callerFamilyId: 'fam-1',
  saasMode: false,
  familyCount: 1,
  onlyFamily: { id: 'fam-1', setupStage: 1 },
};

describe('decideInitialRestore', () => {
  it('allows the admin of the only family during setup', () => {
    expect(decideInitialRestore(fresh)).toBeNull();
  });

  it('always allows the sysadmin', () => {
    expect(decideInitialRestore({ ...fresh, isSysAdmin: true, caretakerRole: null, familyCount: 5, onlyFamily: null, saasMode: true })).toBeNull();
  });

  it('refuses non-admin caretakers', () => {
    expect(decideInitialRestore({ ...fresh, caretakerRole: 'USER' })).not.toBeNull();
  });

  it('refuses once setup is complete', () => {
    expect(decideInitialRestore({ ...fresh, onlyFamily: { id: 'fam-1', setupStage: 3 } })).not.toBeNull();
  });

  it('refuses when more than one family exists', () => {
    expect(decideInitialRestore({ ...fresh, familyCount: 2, onlyFamily: null })).not.toBeNull();
  });

  it('refuses a caller from a different family', () => {
    expect(decideInitialRestore({ ...fresh, callerFamilyId: 'fam-2' })).not.toBeNull();
  });

  it('refuses non-sysadmins in SaaS mode', () => {
    expect(decideInitialRestore({ ...fresh, saasMode: true })).not.toBeNull();
  });
});

describe('follow-up grant after an allowed restore', () => {
  const caller = { authenticated: true, caretakerId: 'ct-1', isSysAdmin: false } as AuthResult;
  const other = { authenticated: true, caretakerId: 'ct-2', isSysAdmin: false } as AuthResult;

  it('is scoped to the caller and expires after 15 minutes', () => {
    const t0 = 1_000_000;
    grantFollowUp(caller, t0);
    expect(hasFollowUpGrant(caller, t0 + 60_000)).toBe(true);
    expect(hasFollowUpGrant(other, t0 + 60_000)).toBe(false);
    expect(hasFollowUpGrant(caller, t0 + 16 * 60_000)).toBe(false);
  });

  it('is never granted to a caller with no identity', () => {
    const anon = { authenticated: true, isSysAdmin: false } as AuthResult;
    grantFollowUp(anon);
    expect(hasFollowUpGrant(anon)).toBe(false);
  });
});

describe('clearFollowUp', () => {
  it('ends the window once migrations complete', async () => {
    const { clearFollowUp } = await import('@/app/api/utils/initial-setup-guard');
    const caller = { authenticated: true, caretakerId: 'ct-clear', isSysAdmin: false } as AuthResult;
    grantFollowUp(caller);
    expect(hasFollowUpGrant(caller)).toBe(true);
    clearFollowUp(caller);
    expect(hasFollowUpGrant(caller)).toBe(false);
  });
});
