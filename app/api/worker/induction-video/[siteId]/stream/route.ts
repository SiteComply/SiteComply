import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { publishedVideoForSite } from '@/services/inductionVideo/renderService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/induction-video/[siteId]/stream
 *
 * The induction video itself, for an operative with a valid session.
 *
 * THE SITE IS THE KEY, NOT THE VERSION. The route resolves whichever version is
 * PUBLISHED for that project right now, so an operative cannot be handed a draft
 * or a superseded one by changing an id — and a video withdrawn while somebody
 * is watching stops being served on their next range request.
 *
 * Ranges are served (see streamMedia), which is what makes a video playable on a
 * phone at all: a player seeks before it plays.
 */
export async function GET(req: NextRequest, { params }: { params: { siteId: string } }) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Your session has expired.' }, { status: 401 });
  }
  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) {
    return NextResponse.json({ ok: false, error: 'Operative not found.' }, { status: 401 });
  }
  const video = await publishedVideoForSite(params.siteId);
  if (!video?.videoBlobPath) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return streamMedia(req, video.videoBlobPath, { contentType: 'video/mp4' });
}
