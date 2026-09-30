import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { sceneAudioForViewer } from '@/services/inductionVideo/narrationService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/induction-video/[videoId]/audio/[sceneId]
 *
 * One scene's narration, so an administrator can hear a single line without playing
 * the whole video. The Admin Centre's copy of the platform route beside it; the
 * shared narration panel used to hard-code the platform path, so this returned 401
 * for every admin. See the transcript route for the fuller note.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { videoId: string; sceneId: string } },
) {
  const admin = getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const file = await sceneAudioForViewer(
    videoActorFromAdmin(admin),
    params.videoId,
    params.sceneId,
  );
  if (!file) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  return streamMedia(req, file.blobPath, { contentType: 'audio/mpeg' });
}
