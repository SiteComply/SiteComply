import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { transcriptForViewer } from '@/services/inductionVideo/narrationService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/induction-video/[videoId]/transcript
 *
 * The written record of what the induction says. A download, not a view: this is
 * the copy that gets attached to an investigation or handed to a client.
 */
export async function GET(req: NextRequest, { params }: { params: { videoId: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  const file = await transcriptForViewer(viewer, params.videoId);
  if (!file) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return streamMedia(req, file.blobPath, {
    contentType: 'text/plain; charset=utf-8',
    fileName: file.fileName,
    download: true,
  });
}
