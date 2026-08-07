import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageNotificationSettings } from '@/services/platformUsers/platformPermissions';
import { savePlatformNotificationSettings } from '@/services/notifications/notificationConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/notification-settings — Director only.
 *
 * The page renders a Project Manager's controls disabled; that is a courtesy.
 * This is the permission.
 */
export async function PATCH(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!canManageNotificationSettings(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'Only Directors can change notification settings.' },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const types: Record<string, boolean> = {};
  const raw = body.types;
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      types[k] = v === true;
    }
  }

  const result = await savePlatformNotificationSettings(
    {
      types,
      actionDueDays: body.actionDueDays as number | string | undefined,
      documentExpiryDays: body.documentExpiryDays as number | string | undefined,
    },
    { userId: viewer.id, name: viewer.name },
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
