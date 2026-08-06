import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageAuthSettings } from '@/services/platformUsers/platformPermissions';
import { savePlatformAuthSettings } from '@/services/auth/authConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/auth-settings
 *
 * Organisation-wide Authentication & Access (Settings). DIRECTOR ONLY — these
 * settings decide how long anyone stays signed in and whether workers can reach
 * a site at all, so they sit with the same role that owns per-site access
 * enforcement.
 *
 * The gate is HERE, not only in the UI. A Project Manager sees this screen
 * read-only, and a read-only screen that is the only thing standing between a
 * request and the database is not a permission.
 *
 * The service decides which FIELDS are writable from this portal: the Admin
 * Centre owns the OTP timings and the SMS channel kill-switch, a Director owns
 * organisation policy. Passing an infrastructure field here does nothing,
 * because savePlatformAuthSettings only reads the keys it owns.
 */
export async function PATCH(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!canManageAuthSettings(viewer.role)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Only Directors can change authentication and access settings.',
      },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await savePlatformAuthSettings(
    {
      sessionTtlSeconds: body.sessionTtlSeconds as number | string | null,
      workerSessionTtlSeconds: body.workerSessionTtlSeconds as
        | number
        | string
        | null,
      workerSmsLoginEnabled: body.workerSmsLoginEnabled === true,
      expressCheckInEnabled: body.expressCheckInEnabled === true,
      invitedWorkersOnly: body.invitedWorkersOnly === true,
      requireActiveSiteAssignment: body.requireActiveSiteAssignment === true,
    },
    { userId: viewer.id, name: viewer.name },
  );

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: Object.values(result.errors)[0] ?? 'Could not save settings.',
        errors: result.errors,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
