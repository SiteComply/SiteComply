import { NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { countUnreadPlatformNotifications } from '@/services/notifications/platformNotifications';

export const dynamic = 'force-dynamic';

/**
 * SC-016 — unread notification count for live in-app delivery.
 *
 * The badge is otherwise rendered by PlatformShell, a SERVER component, so it
 * could only change on a full page render — which is exactly the "notifications
 * only appeared when the page was refreshed" behaviour reported in REV-1. The
 * client poller hits this cheap endpoint and refreshes the route when the count
 * moves.
 *
 * True Web Push (service worker + VAPID) is deliberately a later phase; this
 * fixes the reported problem without new infrastructure or a permission prompt.
 */
export async function GET() {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, count: 0 }, { status: 401 });
  }

  const count = await countUnreadPlatformNotifications(viewer);
  return NextResponse.json(
    { ok: true, count },
    // Never cache: a stale count is the bug this endpoint exists to fix.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
