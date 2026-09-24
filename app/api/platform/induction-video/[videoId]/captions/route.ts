import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { captionsForViewer } from '@/services/inductionVideo/narrationService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/induction-video/[videoId]/captions
 *
 * The WebVTT track. Served inline, because a <track> element loads it rather
 * than a person downloading it.
 */
export async function GET(req: NextRequest, { params }: { params: { videoId: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  const file = await captionsForViewer(viewer, params.videoId);
  if (!file) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return streamMedia(req, file.blobPath, {
    contentType: 'text/vtt; charset=utf-8',
    fileName: file.fileName,
  });
}
