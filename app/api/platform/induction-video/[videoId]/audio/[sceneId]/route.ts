import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { sceneAudioForViewer } from '@/services/inductionVideo/narrationService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';
import { videoActorFromPlatformViewer } from '@/services/inductionVideo/videoActor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/induction-video/[videoId]/audio/[sceneId]
 *
 * One scene's narration, for the reviewer's player. The blob is private: this
 * route is the only way to hear it, and it answers byte ranges so the player can
 * seek (see streamMedia).
 *
 * The scene must belong to the version in the URL — a scene id alone would let
 * a manager on one project fetch audio from another by pairing it with a video
 * they can see.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { videoId: string; sceneId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  const audio = await sceneAudioForViewer(videoActorFromPlatformViewer(viewer), params.videoId, params.sceneId);
  if (!audio) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return streamMedia(req, audio.blobPath, { contentType: 'audio/mpeg' });
}
