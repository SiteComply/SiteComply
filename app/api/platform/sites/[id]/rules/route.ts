import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { withClosedProjectHandling } from '@/lib/routeErrors';
import {
  getSiteRules,
  saveSiteRules,
  siteRulesAreAcknowledged,
  type SiteRule,
} from '@/services/checklists/siteRulesService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Site Rules Library.
 *
 *   GET  /api/platform/sites/[id]/rules  -> { rules, acknowledged }
 *   PUT  /api/platform/sites/[id]/rules     body { rules: [{ label, helpText? }] }
 *
 * Gated identically to the PPE route beside it — the same `sites` edit permission
 * and the same site scope — so the whole Operative experience tab is managed by
 * exactly one set of people. Deliberately not a looser gate: the rules a person
 * agrees to at the gate are a compliance record, not a notice board.
 */

/** Both verbs need the same three checks, so they are asked in one place. */
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
    // 404, not 403: a site outside your scope should not be confirmed to exist.
    return {
      error: NextResponse.json(
        { ok: false, error: 'Not found.' },
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
  if ('error' in auth) return auth.error;

  const [rules, acknowledged] = await Promise.all([
    getSiteRules(params.id),
    siteRulesAreAcknowledged(params.id),
  ]);
  return NextResponse.json({ ok: true, rules, acknowledged });
}

async function PUTHandler(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await authorise(params.id, 'edit');
  if ('error' in auth) return auth.error;

  let body: { rules?: SiteRule[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await saveSiteRules(params.id, body.rules ?? []);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  // `newVersion` is reported so the screen can say a new induction version was
  // published — which is what happens once anyone has inducted against the
  // current one, and is worth telling the person who caused it.
  return NextResponse.json({
    ok: true,
    version: result.version,
    newVersion: result.newVersion,
  });
}

export const GET = withClosedProjectHandling(GETHandler);
export const PUT = withClosedProjectHandling(PUTHandler);
