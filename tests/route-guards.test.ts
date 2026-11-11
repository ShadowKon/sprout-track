import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Source guards for authorization checks in routes that need a database to
 * exercise end to end. Behavior was verified live against a test container.
 */
const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf-8');

describe('route authorization guards', () => {
  it('setup/start refuses family admins once their setup is complete', () => {
    const src = read('app/api/setup/start/route.ts');
    expect(src).toMatch(/if \(!authResult\.isSysAdmin\) \{[\s\S]*?setupStage >= 3/);
    expect(src).toMatch(/families\[0\]\.id === authResult\.familyId/);
  });

  it('baby/create scopes the family from the auth context, not the body', () => {
    const src = read('app/api/baby/create/route.ts');
    expect(src).toContain('resolveFamilyScope(authContext, requestedFamilyId)');
    expect(src).toContain('const familyId = scope.familyId;');
  });

  it('a successful login does not clear the family lockout counter', () => {
    const src = read('app/api/auth/route.ts');
    const reset = src.slice(src.indexOf('const resetLoginFailures'), src.indexOf('};', src.indexOf('const resetLoginFailures')));
    expect(reset).toContain('resetFailedAttempts(ip)');
    expect(reset).not.toContain('targetKey');
  });

  it('restore-initial grants the follow-up window only after a successful restore', () => {
    const src = read('app/api/database/restore-initial/route.ts');
    const handlerStart = src.indexOf('async function handler');
    const firstGrant = src.indexOf('grantFollowUp(authContext)', handlerStart);
    expect(firstGrant).toBeGreaterThan(src.indexOf('reloadEnvFile(envPath)', handlerStart));
    expect(read('app/api/database/migrate-initial/route.ts')).toContain('clearFollowUp(authContext)');
  });
});
