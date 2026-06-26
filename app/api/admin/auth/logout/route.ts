import { NextRequest, NextResponse } from 'next/server';
import { azureLogoutUrl, isAzureAdConfigured } from '@/services/auth/adminAuth';
import { clearAdminSessionCookie } from '@/lib/session';
import { appConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/auth/logout
 * Clears the admin session. With Azure AD configured, also ends the session at
 * Microsoft so the next sign-in re-authenticates.
 */
export async function GET(req: NextRequest) {
  clearAdminSessionCookie();

  const loginUrl = new URL('/admin/login', req.url).toString();
  if (isAzureAdConfigured()) {
    return NextResponse.redirect(
      azureLogoutUrl(`${appConfig.baseUrl}/admin/login`),
    );
  }
  return NextResponse.redirect(loginUrl);
}
