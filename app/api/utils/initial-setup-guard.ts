import prisma from '../db';
import { AuthResult } from './auth';

/**
 * Authorization for the *-initial database routes (restore-initial,
 * pre-migration-check-initial, migrate-initial). A restore replaces the whole
 * database and .env, so outside the sysadmin it is only allowed while the
 * install is fresh: one family, setup not finished, caller is its admin.
 *
 * After an allowed restore the database is the backup, so the fresh-install
 * check no longer holds for the follow-up migration calls. Those are allowed
 * for the same caller for a short window instead (process-local; the app runs
 * as a single Next.js server).
 */

export interface InitialRestoreState {
  isSysAdmin: boolean;
  caretakerRole?: string | null;
  callerFamilyId?: string | null;
  saasMode: boolean;
  familyCount: number;
  onlyFamily: { id: string; setupStage: number } | null;
}

/** Pure decision: returns an error message, or null when allowed. */
export function decideInitialRestore(s: InitialRestoreState): string | null {
  if (s.isSysAdmin) return null;
  if (s.saasMode) return 'Initial restore is only available to the system administrator';
  if (s.caretakerRole !== 'ADMIN') return 'Only an admin can restore during initial setup';
  if (s.familyCount !== 1 || !s.onlyFamily) return 'Initial restore is only available on a fresh install';
  if (s.onlyFamily.id !== s.callerFamilyId) return 'Not authorized for this family';
  if (s.onlyFamily.setupStage >= 3) return 'Setup is already complete; use the Family Manager to restore';
  return null;
}

export async function checkInitialRestore(auth: AuthResult): Promise<string | null> {
  const familyCount = await prisma.family.count();
  const onlyFamily = familyCount === 1
    ? await prisma.family.findFirst({ select: { id: true, setupStage: true } })
    : null;
  return decideInitialRestore({
    isSysAdmin: !!auth.isSysAdmin,
    caretakerRole: auth.caretakerRole,
    callerFamilyId: auth.familyId,
    saasMode: process.env.DEPLOYMENT_MODE === 'saas',
    familyCount,
    onlyFamily,
  });
}

const FOLLOW_UP_WINDOW_MS = 15 * 60 * 1000;
const followUpGrants = new Map<string, number>();

function grantKey(auth: AuthResult): string | null {
  if (auth.isSysAdmin) return 'sysadmin';
  return auth.caretakerId ?? null;
}

/** Call after an allowed restore so the same caller can run the migration steps. */
export function grantFollowUp(auth: AuthResult, now = Date.now()): void {
  const key = grantKey(auth);
  if (key) followUpGrants.set(key, now + FOLLOW_UP_WINDOW_MS);
}

export function hasFollowUpGrant(auth: AuthResult, now = Date.now()): boolean {
  const key = grantKey(auth);
  if (!key) return false;
  const expires = followUpGrants.get(key);
  if (!expires) return false;
  if (now > expires) {
    followUpGrants.delete(key);
    return false;
  }
  return true;
}

/** For pre-migration-check-initial and migrate-initial. */
export async function checkInitialFollowUp(auth: AuthResult): Promise<string | null> {
  if (hasFollowUpGrant(auth)) return null;
  return checkInitialRestore(auth);
}
