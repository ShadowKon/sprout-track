import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../db';
import { ApiResponse } from '../../types';
import { withAuthContext, AuthResult } from '../../utils/auth';
import { resolveFamilyScope } from '../../utils/family-scope';
import { verifyPin } from '../../utils/pin-utils';
import { checkIpLockout, recordFailedAttempt, resetFailedAttempts } from '../../utils/ip-lockout';
import { TARGET_MAX_ATTEMPTS } from '../../utils/login-target';

/**
 * POST /api/settings/verify-pin
 *
 * Verifies a submitted PIN against the family's current security PIN, server-side.
 * This exists so the client never needs the actual PIN to confirm it (e.g. the
 * "verify current PIN" step of the change-PIN flow). Scoped to the authenticated
 * user's family; only ever returns a boolean.
 */
async function handler(
  req: NextRequest,
  authContext: AuthResult
): Promise<NextResponse<ApiResponse<{ valid: boolean }>>> {
  try {
    const { searchParams } = new URL(req.url);
    const queryFamilyId = searchParams.get('familyId');

    const scope = resolveFamilyScope(authContext, queryFamilyId);
    if (!scope.ok) {
      return NextResponse.json<ApiResponse<{ valid: boolean }>>(
        { success: false, error: scope.error },
        { status: scope.status }
      );
    }
    const targetFamilyId = scope.familyId;

    // Changing the family PIN is admin-only, so verifying it is too. Failures
    // are rate limited per caller and per family: this endpoint is otherwise an
    // oracle for the family login PIN.
    const isAdmin = authContext.caretakerRole === 'ADMIN' ||
                    authContext.caretakerRole === 'OWNER' ||
                    authContext.isSysAdmin;
    if (!isAdmin) {
      return NextResponse.json<ApiResponse<{ valid: boolean }>>(
        { success: false, error: 'Only admins can verify the family PIN' },
        { status: 403 }
      );
    }
    const callerKey = `target:verify-pin:caller:${authContext.isSysAdmin ? 'sysadmin' : authContext.caretakerId}`;
    const familyKey = `target:verify-pin:family:${targetFamilyId}`;
    const lockout = [checkIpLockout(callerKey), checkIpLockout(familyKey)].find(l => l.locked);
    if (lockout) {
      return NextResponse.json<ApiResponse<{ valid: boolean }>>(
        { success: false, error: `Too many failed attempts. Please try again in ${Math.ceil(lockout.remainingTime / 60000)} minutes.` },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const pin = typeof body?.pin === 'string' ? body.pin : '';

    if (!pin) {
      return NextResponse.json<ApiResponse<{ valid: boolean }>>({
        success: true,
        data: { valid: false },
      });
    }

    const settings = await prisma.settings.findFirst({
      where: { familyId: targetFamilyId },
      select: { securityPin: true },
    });

    const valid = !!settings && (await verifyPin(pin, settings.securityPin)).valid;
    if (valid) {
      resetFailedAttempts(callerKey);
      resetFailedAttempts(familyKey);
    } else {
      recordFailedAttempt(callerKey);
      recordFailedAttempt(familyKey, TARGET_MAX_ATTEMPTS);
    }

    return NextResponse.json<ApiResponse<{ valid: boolean }>>({
      success: true,
      data: { valid },
    });
  } catch (error) {
    console.error('Error verifying PIN:', error);
    return NextResponse.json<ApiResponse<{ valid: boolean }>>(
      { success: false, error: 'Failed to verify PIN' },
      { status: 500 }
    );
  }
}

export const POST = withAuthContext(handler);
