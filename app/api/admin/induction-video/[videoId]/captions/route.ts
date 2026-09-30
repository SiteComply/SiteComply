import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { captionsForViewer } from '@/services/inductionVideo/narrationService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/induction-video/[videoId]/captions
 *
 * The WebVTT track, for the <track> element on the preview player and for anybody
 * checking the subtitles before a video goes live. Served inline, not downloaded: a
 * browser reads it, rather than a person.
 *
 * See the transcript route beside this one for why the admin tier was missing it.
 */
export async function GET(req: NextRequest, { params }: { params: { videoId: string } }) {
  const admin = getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const file = await captionsForViewer(videoActorFromAdmin(admin), params.videoId);
  if (!file) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  return streamMedia(req, file.blobPath, {
    contentType: 'text/vtt; charset=utf-8',
    fileName: file.fileName,
  });
}
