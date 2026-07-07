import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getDocumentExpiryNotifications } from '@/services/documents/documentExpiryNotifications';
import { setNotificationRead } from '@/services/notifications/notificationReadService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/notifications/read
 * Body: { key: string, read: boolean }
 * Mark a single notification read (true) or unread (false) for the current user.
 * Only notifications the viewer can currently see — i.e. within their
 * Assigned-Sites scope — may be marked (validated against the derived set).
 */
export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'documents', 'view')) {
    return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }

  let body: { key?: string; read?: boolean };
  try {
    body = (await req.json()) as { key?: string; read?: boolean };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const key = (body.key ?? '').trim();
  if (!key) {
    return NextResponse.json({ ok: false, error: 'Missing notification.' }, { status: 400 });
  }

  // Scope + RBAC: only keys present in the viewer's current notifications.
  const validKeys = new Set(
    (await getDocumentExpiryNotifications(viewer)).map((n) => n.key),
  );
  if (!validKeys.has(key)) {
    return NextResponse.json({ ok: false, error: 'Notification not found.' }, { status: 404 });
  }

  await setNotificationRead(viewer.id, key, body.read !== false);
  return NextResponse.json({ ok: true });
}
