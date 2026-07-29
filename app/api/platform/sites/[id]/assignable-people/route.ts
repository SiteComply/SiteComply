import { NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getAssignablePeople } from '@/services/actions/actionAssigneeService';

/**
 * SC-015 — people an action may be assigned to on this site: workers currently
 * inducted, or (when there are none) the platform users assigned to the site.
 *
 * Gated on `actions:create` AND the viewer's site scope, and 404s an out-of-scope
 * site rather than 403-ing: this returns worker names and employers, so it must
 * not confirm that a site the viewer cannot see exists.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'actions', 'create')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to raise actions.' },
      { status: 403 },
    );
  }

  const result = await getAssignablePeople(viewer, params.id);
  if (!result) {
    return NextResponse.json(
      { ok: false, error: 'Site not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
