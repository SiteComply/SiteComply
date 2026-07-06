import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { saveAuthConfig, type SaveAuthConfigInput } from '@/services/auth/authConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/authentication
 * Save the authentication configuration. Admin-only. Body:
 *   { otpTtlSeconds, otpMaxAttempts, sessionTtlSeconds, smsOtpEnabled, emailOtpEnabled }
 * Numeric values are range-validated server-side.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  let body: SaveAuthConfigInput;
  try {
    body = (await req.json()) as SaveAuthConfigInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = await saveAuthConfig(body, {
    adminId: admin.adminId,
    name: admin.name,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
