import { NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getPlatformNotifications } from '@/services/notifications/platformNotifications';
import { markNotificationsRead } from '@/services/notifications/notificationReadService';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/notifications/read-all
 * Mark all of the current user's visible notifications read. Only the viewer's
 * own, in-scope (derived) notifications are affected.
 */
async function POSTHandler() {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  const keys = (await getPlatformNotifications(viewer)).map((n) => n.key);
  await markNotificationsRead(viewer.id, keys);
  return NextResponse.json({ ok: true, count: keys.length });
}

export const POST = withClosedProjectHandling(POSTHandler);
