import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  listVideosForSite,
  readinessForSite,
  requestScript,
} from '@/services/inductionVideo/inductionVideoService';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A project's induction videos.
 *
 *   GET                      → versions, plus the readiness check
 *   POST { action: 'generate' } → queue a script for the next version
 *
 * Generation only QUEUES work. The scheduler runs it, so a model that takes
 * thirty seconds never holds an HTTP request open.
 */
async function GETHandler(_req: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });

  const [videos, readiness] = await Promise.all([
    listVideosForSite(viewer, params.id),
    readinessForSite(viewer, params.id),
  ]);
  if (!videos || !readiness) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, videos, readiness });
}

async function POSTHandler(req: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  if (body.action !== 'generate') {
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }

  const result = await requestScript(viewer, params.id);
  return result.ok
    ? NextResponse.json({ ok: true, ...result.value })
    : NextResponse.json({ ok: false, error: result.error }, { status: 400 });
}

export const GET = withClosedProjectHandling(GETHandler);
export const POST = withClosedProjectHandling(POSTHandler);
