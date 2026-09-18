import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { withClosedProjectHandling } from '@/lib/routeErrors';
import {
  getRiskRegister,
  saveRiskTopic,
} from '@/services/sites/cppRiskService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CPP Tier 2 — the significant-risk register.
 *
 *   GET  /api/platform/sites/[id]/risks  -> the whole register
 *   PUT  /api/platform/sites/[id]/risks     body { topic, applicable, controls? }
 *
 * PUT saves ONE topic. Twenty-five topics is a long form worked through over more
 * than one sitting, and a save-everything endpoint would make a half-finished
 * register an all-or-nothing write. Gated exactly like the rules and PPE routes
 * beside it: the same `sites` permission and the same site scope.
 */
async function authorise(siteId: string, action: 'view' | 'edit') {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'Not signed in.' },
        { status: 401 },
      ),
    };
  }
  if (!permits(viewer.role, 'sites', action)) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'You cannot configure this site.' },
        { status: 403 },
      ),
    };
  }
  if (!viewer.siteIds.includes(siteId)) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'Site not found.' },
        { status: 404 },
      ),
    };
  }
  return { viewer };
}

async function GETHandler(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await authorise(params.id, 'view');
  if (auth.error) return auth.error;
  return NextResponse.json({ ok: true, register: await getRiskRegister(params.id) });
}

async function PUTHandler(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await authorise(params.id, 'edit');
  if (auth.error) return auth.error;

  let body: { topic?: string; applicable?: boolean | null; controls?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  if (!body.topic) {
    return NextResponse.json({ ok: false, error: 'No topic given.' }, { status: 400 });
  }
  // `applicable` is deliberately TRISTATE: null means "not yet considered", and
  // clearing an answer back to null has to be possible. `=== undefined` rather
  // than a falsy check, or false would be read as absent.
  const applicable =
    body.applicable === undefined ? null : (body.applicable as boolean | null);

  const result = await saveRiskTopic(auth.viewer!, params.id, {
    topic: body.topic,
    applicable,
    controls: body.controls ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, register: await getRiskRegister(params.id) });
}

export const GET = withClosedProjectHandling(GETHandler);
export const PUT = withClosedProjectHandling(PUTHandler);
