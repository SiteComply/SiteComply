import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { recordProgress } from '@/services/inductionVideo/operativeVideoService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/induction-video/[siteId]/progress  { videoId, positionMs }
 *
 * Records how far an operative has watched. The client reports its position; the
 * SERVER decides what that means — it only ever raises the high-water mark, and
 * completion is worked out here rather than claimed by the player, because a
 * player that could claim completion would be one edited request away from a
 * false induction record.
 */
export async function POST(req: NextRequest, { params }: { params: { siteId: string } }) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Your session has expired.' }, { status: 401 });
  }
  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) {
    return NextResponse.json({ ok: false, error: 'Operative not found.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const videoId = typeof body.videoId === 'string' ? body.videoId : '';
  const positionMs = Number(body.positionMs);
  if (!videoId || !Number.isFinite(positionMs)) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = await recordProgress(
    { id: worker.id, fullName: worker.fullName },
    params.siteId,
    videoId,
    positionMs,
    typeof body.submissionId === 'string' ? body.submissionId : null,
  );
  if (!result) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}
