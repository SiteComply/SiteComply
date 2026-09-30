import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/induction-video/[videoId]/video
 *
 * The rendered MP4, for the administrator reviewing it before publication. Served by
 * range like all our media, so the player can seek without pulling the whole file.
 *
 * ── AUTHORITY ─────────────────────────────────────────────────────────────
 *
 * An Admin Centre actor's scope is every project, so there is no per-site test to
 * make: `maySite` is true throughout for an OWNER or ADMIN and false for a VIEWER,
 * and a company video belongs to no project at all. Asking the actor rather than
 * re-deriving the rule keeps this route from becoming a second opinion about who may
 * watch an unpublished video — which is what the platform route's own comment warns
 * about.
 */
export async function GET(req: NextRequest, { params }: { params: { videoId: string } }) {
  const admin = getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const actor = videoActorFromAdmin(admin);
  const video = await prisma.inductionVideo.findUnique({
    where: { id: params.videoId },
    select: { jobSiteId: true, videoBlobPath: true },
  });
  const allowed = video?.jobSiteId ? actor.maySite(video.jobSiteId) : actor.canManage;
  if (!video?.videoBlobPath || !allowed) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return streamMedia(req, video.videoBlobPath, { contentType: 'video/mp4' });
}
