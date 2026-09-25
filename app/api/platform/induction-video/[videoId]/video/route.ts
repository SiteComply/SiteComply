import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { prisma } from '@/lib/prisma';
import { canManageInductionVideos } from '@/services/inductionVideo/inductionVideoPermissions';
import { canWorkOnVideoSite } from '@/services/inductionVideo/inductionVideoService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/induction-video/[videoId]/video
 *
 * The rendered MP4, for the manager reviewing it before publication. Any
 * version they may work on — including a draft nobody has published and a
 * superseded one they are checking back on — served by range like all our media.
 */
export async function GET(req: NextRequest, { params }: { params: { videoId: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  const video = await prisma.inductionVideo.findUnique({
    where: { id: params.videoId },
    select: { jobSiteId: true, videoBlobPath: true },
  });
  // A company video belongs to no project: authority over company content is the
  // bar, the same one the Library and Company Modules use.
  const allowed = video?.jobSiteId
    ? canWorkOnVideoSite(viewer, video.jobSiteId)
    : canManageInductionVideos(viewer.role);
  if (!video?.videoBlobPath || !allowed) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return streamMedia(req, video.videoBlobPath, { contentType: 'video/mp4' });
}
