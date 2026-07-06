import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import {
  saveNotificationConfig,
  type SaveNotificationConfigInput,
} from '@/services/notifications/notificationConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/notifications
 * Save the platform notification configuration. Admin-only. Body:
 *   { types: { [typeKey]: { enabled, channels: { email, sms } } } }
 * Unknown types/channels are ignored; all values are coerced to booleans.
 */
export async function POST(req: NextRequest) {
  const admin = getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  let body: SaveNotificationConfigInput;
  try {
    body = (await req.json()) as SaveNotificationConfigInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = await saveNotificationConfig(body, {
    adminId: admin.adminId,
    name: admin.name,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
