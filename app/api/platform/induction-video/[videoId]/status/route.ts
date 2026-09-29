import { NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { videoActorFromPlatformViewer } from '@/services/inductionVideo/videoActor';
import { videoProgress } from '@/services/inductionVideo/progressService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/induction-video/[videoId]/status
 *
 * "Has anything changed?" — the cheap poll the version page uses while a job runs.
 *
 * Deliberately NOT the existing GET on the parent route: that returns the whole
 * version through getVideo, and polling it every few seconds is the load this
 * endpoint exists to avoid. See progressService.ts for what that load did to
 * production.
 */
export async function GET(_req: Request, { params }: { params: { videoId: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const progress = await videoProgress(
    videoActorFromPlatformViewer(viewer),
    params.videoId,
  );
  if (!progress) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...progress });
}
