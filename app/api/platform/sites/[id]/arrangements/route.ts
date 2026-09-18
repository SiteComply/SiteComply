import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { withClosedProjectHandling } from '@/lib/routeErrors';
import {
  resolveArrangements,
  saveSiteArrangement,
} from '@/services/sites/arrangementService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CPP Tier 3A — SITE-level arrangement overrides.
 *
 *   GET -> the six arrangements as resolved for this site, with their source
 *   PUT    body { key, content }   (content null REMOVES the override)
 *
 * Absent means inherit, so clearing an override is a delete — there is no
 * "usesDefault" flag that could disagree with the content. Follows the same
 * `sites:edit` gate as the rules and PPE routes; the service re-checks.
 */
async function GETHandler(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!viewer.siteIds.includes(params.id)) {
    return NextResponse.json({ ok: false, error: 'Site not found.' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    arrangements: await resolveArrangements(params.id),
  });
}

async function PUTHandler(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  let body: { key?: string; content?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  if (!body.key) {
    return NextResponse.json({ ok: false, error: 'No arrangement given.' }, { status: 400 });
  }
  const result = await saveSiteArrangement(viewer, params.id, body.key, body.content ?? null);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    arrangements: await resolveArrangements(params.id),
  });
}

export const GET = withClosedProjectHandling(GETHandler);
export const PUT = withClosedProjectHandling(PUTHandler);
