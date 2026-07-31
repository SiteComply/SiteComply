import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  saveSmsConfig,
  type SaveSmsConfigInput,
} from '@/services/sms/smsConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/sms
 * Save the SMS provider configuration. Admin-only. Body:
 *   { activeProvider, settings: { [providerId]: { [field]: value } } }
 * Secret fields left blank keep their stored (encrypted) value.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  let body: SaveSmsConfigInput;
  try {
    body = (await req.json()) as SaveSmsConfigInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await saveSmsConfig(body, {
    adminId: admin.adminId,
    name: admin.name,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, errors: result.errors },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
