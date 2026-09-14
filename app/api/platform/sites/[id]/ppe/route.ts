import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { withClosedProjectHandling } from '@/lib/routeErrors';
import {
  saveSitePpeRequirements,
  type PpeRequirement,
} from '@/services/checklists/sitePpeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/platform/sites/[id]/ppe
 *   body { items: [{ label, helpText?, required }] }
 *
 * Owner Review Item 15. Gated on the same `sites` edit permission plus site
 * scope as the other Operative Experience settings, so PPE is managed by exactly
 * the people who manage the knowledge check and induction validity beside it.
 */
async function PUTHandler(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'sites', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot configure this site.' },
      { status: 403 },
    );
  }
  if (!viewer.siteIds.includes(params.id)) {
    return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  let body: { items?: PpeRequirement[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await saveSitePpeRequirements(params.id, body.items ?? []);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  // `newVersion` is reported so the screen can say that a new checklist version
  // was published — which is what happens once anyone has inducted against the
  // current one, and is worth telling the person who caused it.
  return NextResponse.json({
    ok: true,
    version: result.version,
    newVersion: result.newVersion,
  });
}

export const PUT = withClosedProjectHandling(PUTHandler);
