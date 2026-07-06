import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { saveSmsConfig, type SaveSmsConfigInput } from '@/services/sms/smsConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/sms
 * Save the SMS provider configuration. Admin-only. Body:
 *   { activeProvider, settings: { [providerId]: { [field]: value } } }
 * Secret fields left blank keep their stored (encrypted) value.
 */
export async function POST(req: NextRequest) {
  const admin = getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  let body: SaveSmsConfigInput;
  try {
    body = (await req.json()) as SaveSmsConfigInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
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
