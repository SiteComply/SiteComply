import { NextResponse } from 'next/server';
import { clearPlatformSessionCookie } from '@/lib/session';
import { appConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/auth/logout
 * Ends the platform session and returns to the home page.
 */
export async function GET() {
  clearPlatformSessionCookie();
  return NextResponse.redirect(new URL('/', appConfig.baseUrl));
}
