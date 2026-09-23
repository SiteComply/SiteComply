import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageWorkerAccess } from '@/services/workerAccess/workerAssignmentService';
import {
  createSiteCompany,
  listSiteCompanies,
  mergeCompanies,
  removeSiteCompany,
  renameSiteCompany,
} from '@/services/companies/siteCompanyService';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The companies working on one project.
 *
 *   GET                                    → the list, with usage counts
 *   POST   { action: 'add', name }         → a new company on this project
 *   POST   { action: 'rename', id, name }
 *   POST   { action: 'remove', id }        → only when nothing points at it
 *   POST   { action: 'merge', fromId, intoId }
 *
 * Gated on the SAME permission as inviting an operative: whoever decides who
 * works here decides which companies are here.
 */
async function guard(siteId: string) {
  const viewer = await getPlatformViewer();
  if (!viewer) return null;
  // The same test inviteWorker applies: the capability, plus this site being in
  // the viewer's scope.
  if (!canManageWorkerAccess(viewer.role)) return null;
  if (!viewer.siteIds.includes(siteId)) return null;
  return viewer;
}

async function GETHandler(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await guard(params.id);
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, companies: await listSiteCompanies(params.id) });
}

async function POSTHandler(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await guard(params.id);
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const actor = { id: viewer.id, name: viewer.name };

  switch (body.action) {
    case 'add': {
      const r = await createSiteCompany(params.id, str('name'), actor);
      return r.ok
        ? NextResponse.json({ ok: true, company: r.value })
        : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    case 'rename': {
      const r = await renameSiteCompany(params.id, str('id'), str('name'));
      return r.ok
        ? NextResponse.json({ ok: true, company: r.value })
        : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    case 'remove': {
      const r = await removeSiteCompany(params.id, str('id'));
      return r.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    case 'merge': {
      const r = await mergeCompanies(params.id, str('fromId'), str('intoId'));
      return r.ok
        ? NextResponse.json({ ok: true, merged: r.value })
        : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    default:
      return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }
}

export const GET = withClosedProjectHandling(GETHandler);
export const POST = withClosedProjectHandling(POSTHandler);
