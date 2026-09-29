import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';
import { videoProgress } from '@/services/inductionVideo/progressService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/induction-video/[videoId]/status
 *
 * The Admin Centre's half of the same poll. Open to any signed-in admin including
 * VIEWER: watching a generation finish is exactly what a read-only role is for.
 */
export async function GET(_req: Request, { params }: { params: { videoId: string } }) {
  const admin = getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const progress = await videoProgress(videoActorFromAdmin(admin), params.videoId);
  if (!progress) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...progress });
}
