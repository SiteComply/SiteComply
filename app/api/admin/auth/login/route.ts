import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthCodeUrl, isAzureAdConfigured } from '@/services/auth/adminAuth';
import { upsertAdminFromAzure } from '@/services/admins/adminService';
import { createAdminSessionToken, setAdminSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'sc_admin_oauth_state';

/**
 * GET /api/admin/auth/login
 * Starts admin sign-in. With Azure AD configured, redirects to Microsoft with a
 * CSRF state token. Without it (local dev), signs in as a development admin so
 * the dashboard is reachable — never available in production.
 */
export async function GET(req: NextRequest) {
  if (isAzureAdConfigured()) {
    const state = randomBytes(16).toString('hex');
    const url = await getAuthCodeUrl(state);
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    return res;
  }

  // --- Development fallback (no Azure AD configured) ---
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.redirect(new URL('/admin/login?error=config', req.url));
  }

  const admin = await upsertAdminFromAzure({
    azureObjectId: 'dev-local-admin',
    email: 'dev.admin@sitecomply.local',
    displayName: 'Dev Administrator',
  });
  setAdminSessionCookie(
    createAdminSessionToken({
      adminId: admin.id,
      email: admin.email,
      name: admin.displayName,
      role: admin.role,
    }),
  );
  return NextResponse.redirect(new URL('/admin', req.url));
}
