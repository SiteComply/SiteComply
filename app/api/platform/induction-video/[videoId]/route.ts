import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getVideo } from '@/services/inductionVideo/inductionVideoService';
import { videoActorFromPlatformViewer } from '@/services/inductionVideo/videoActor';
import { handleVideoAction } from '@/services/inductionVideo/videoActions';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One version of an induction video, from the Platform.
 *
 *   GET    → scenes, history, staleness
 *   PATCH  → editScene · removeScene · approve · narrate · render · publish · withdraw
 *
 * This route authenticates and nothing else. Every action lives in
 * `handleVideoAction`, shared verbatim with the Admin Centre route.
 */
async function GETHandler(_req: NextRequest, { params }: { params: { videoId: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });
  const detail = await getVideo(videoActorFromPlatformViewer(viewer), params.videoId);
  if (!detail) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...detail });
}

async function PATCHHandler(req: NextRequest, { params }: { params: { videoId: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const { status, payload } = await handleVideoAction(
    videoActorFromPlatformViewer(viewer),
    params.videoId,
    body,
  );
  return NextResponse.json(payload, { status });
}

export const GET = withClosedProjectHandling(GETHandler);
export const PATCH = withClosedProjectHandling(PATCHHandler);
