import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { videoForOperative } from '@/services/inductionVideo/operativeVideoService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/induction-video/[siteId]
 *
 * What this operative should be shown for this project: the published version,
 * its length, whether the site requires it, and how far they have already got.
 * Returns `{ ok: true, video: null }` — not an error — when the project has no
 * published video, because that is the normal case and the induction must carry
 * on exactly as it did before.
 */
export async function GET(_req: NextRequest, { params }: { params: { siteId: string } }) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Your session has expired.' }, { status: 401 });
  }
  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) {
    return NextResponse.json({ ok: false, error: 'Operative not found.' }, { status: 401 });
  }
  const video = await videoForOperative(worker.id, params.siteId);
  return NextResponse.json({ ok: true, video });
}
