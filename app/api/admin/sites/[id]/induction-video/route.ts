import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { getAdminSession } from '@/lib/session';
import {
  listVideosForSite,
  readinessForSite,
} from '@/services/inductionVideo/inductionVideoService';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';
import { handleSiteVideoAction } from '@/services/inductionVideo/videoActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A project's induction videos, from the Admin Centre.
 *
 *   GET                        → versions, plus the readiness check
 *   POST { action: 'generate' } → queue a script for the next version, which is
 *                                 also how a regeneration is expressed
 *
 * The same dispatcher the Platform uses. An admin's site scope is every project,
 * so no assigned-sites test applies here — see videoActor.ts.
 */
async function GETHandler(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const actor = videoActorFromAdmin(admin);
  const [videos, readiness] = await Promise.all([
    listVideosForSite(actor, params.id),
    readinessForSite(actor, params.id),
  ]);
  if (!videos || !readiness) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, videos, readiness });
}

async function POSTHandler(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const { status, payload } = await handleSiteVideoAction(
    videoActorFromAdmin(auth.admin),
    params.id,
    body,
  );
  return NextResponse.json(payload, { status });
}

export const GET = GETHandler;
export const POST = POSTHandler;
