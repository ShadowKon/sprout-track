import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '../../types';
import { checkIpLockout } from '../../utils/ip-lockout';

/**
 * API endpoint to check if an IP is locked out.
 *
 * Read-only on purpose: failures are recorded and cleared server-side inside
 * /api/auth. Public POST/DELETE handlers used to exist here, and the DELETE let
 * any client wipe its own lockout between guesses.
 */
export async function GET(req: NextRequest) {
  // Get the client IP
  const ip = req.headers.get('x-forwarded-for') || 
             req.headers.get('x-real-ip') || 
             'unknown';
  
  const { locked, remainingTime } = checkIpLockout(ip);
  
  return NextResponse.json<ApiResponse<{ locked: boolean; remainingTime: number }>>(
    {
      success: true,
      data: { locked, remainingTime }
    }
  );
}

