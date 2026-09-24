import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { publishedVideoForSite } from '@/services/inductionVideo/renderService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/induction-video/[siteId]/captions
 *
 * The subtitle track for the published video. Every operative gets this, not
 * only those who ask: the <track> element loads it, and an induction that can
 * only be followed by ear excludes people who are on site every day.
 */
export async function GET(req: NextRequest, { params }: { params: { siteId: string } }) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Your session has expired.' }, { status: 401 });
  }
  const video = await publishedVideoForSite(params.siteId);
  if (!video?.captionsBlobPath) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return streamMedia(req, video.captionsBlobPath, { contentType: 'text/vtt; charset=utf-8' });
}
