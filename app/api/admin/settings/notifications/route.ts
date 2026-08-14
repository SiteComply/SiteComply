import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/notifications — RETIRED.
 *
 * Notification settings moved to Platform Settings → Notifications, where a
 * Director owns them. The Admin Centre keeps a READ-ONLY view as the platform
 * operator's fallback.
 *
 * Two editors of one singleton row is the duplicate source of truth that
 * section exists to remove: this route and the Platform one wrote the same
 * `notifications` row through different surfaces, so the same setting could be
 * changed from two places with different permissions and different controls.
 *
 * 409, not 403 — the caller is not forbidden, the operation has moved. The
 * route is kept rather than deleted so an older tab or a bookmarked form gets
 * this explanation instead of a 404 it cannot interpret.
 *
 * Exactly the treatment /api/admin/settings/company received when company
 * profile and branding moved, and for the same reason.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        'Notification settings are now managed in Platform Settings → Notifications. This view is read-only.',
    },
    { status: 409 },
  );
}
