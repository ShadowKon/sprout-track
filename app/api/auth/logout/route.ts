import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '../../types';
import { invalidateToken, clearRefreshTokenCookie } from '../../utils/auth';

/**
 * Handles logout requests by clearing authentication cookies
 */
export async function POST(req: NextRequest) {
  try {
    // Get the authorization header to invalidate the token
    const authHeader = req.headers.get('Authorization');
    let token: string | undefined;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
      // Add the token to the blacklist
      if (token) {
        invalidateToken(token);
      }
    }
    
    // Clear the caretakerId cookie (for backward compatibility)
    const response = NextResponse.json<ApiResponse<{ success: boolean }>>(
      {
        success: true,
        data: { success: true },
      },
      { status: 200 }
    );
    
    // Clear any legacy caretakerId cookie left in browsers from older versions.
    // It is no longer set or accepted as authentication.
    response.cookies.set('caretakerId', '', {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'strict',
      path: '/',
      maxAge: 0, // Expire immediately
    });

    // Clear the refresh token cookie
    clearRefreshTokenCookie(response);

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json<ApiResponse<null>>(
      {
        success: false,
        error: 'Failed to logout',
      },
      { status: 500 }
    );
  }
}
