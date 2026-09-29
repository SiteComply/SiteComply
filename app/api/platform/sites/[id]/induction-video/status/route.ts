import { NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { videoActorFromPlatformViewer } from '@/services/inductionVideo/videoActor';
import { siteProgress } from '@/services/inductionVideo/progressService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — "has anything changed?" across one project's versions. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const progress = await siteProgress(videoActorFromPlatformViewer(viewer), params.id);
  if (!progress) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...progress });
}
