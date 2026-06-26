import { NextRequest, NextResponse } from 'next/server';
import { acquireAdminIdentity } from '@/services/auth/adminAuth';
import { upsertAdminFromAzure } from '@/services/admins/adminService';
import { createAdminSessionToken, setAdminSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'sc_admin_oauth_state';

/**
 * GET /api/admin/auth/callback
 * Azure AD redirect target. Validates the CSRF state, exchanges the code for
 * tokens, maps the Azure object id to an Admin (creating it on first login),
 * establishes the admin session and lands on the dashboard.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/admin/login?error=${reason}`, req.url));

  if (params.get('error')) return fail('sso');
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail('state');
  }

  try {
    const identity = await acquireAdminIdentity(code);
    const admin = await upsertAdminFromAzure(identity);
    setAdminSessionCookie(
      createAdminSessionToken({
        adminId: admin.id,
        email: admin.email,
        name: admin.displayName,
        role: admin.role,
      }),
    );
  } catch {
    return fail('exchange');
  }

  const res = NextResponse.redirect(new URL('/admin', req.url));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
