import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageInductionVideos } from '@/services/inductionVideo/inductionVideoPermissions';
import { getVideo } from '@/services/inductionVideo/inductionVideoService';
import { videoActorFromPlatformViewer } from '@/services/inductionVideo/videoActor';
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
import { VideoVersionSurface } from '@/components/inductionVideo/VideoVersionSurface';

export const dynamic = 'force-dynamic';

/**
 * One version of an induction video, in the Platform.
 *
 * The working surface itself — script, narration, render, publish, history — is
 * `VideoVersionSurface`, shared with the Admin Centre so the two entry points
 * cannot disagree about the same version. This page is the Platform's shell
 * around it: its chrome, its breadcrumbs, and its actor.
 */
export default async function InductionVideoVersionPage({
  params,
}: {
  params: { videoId: string };
}) {
  const viewer = await requirePlatformViewer();
  if (!canManageInductionVideos(viewer.role)) redirect('/platform/dashboard');

  const detail = await getVideo(videoActorFromPlatformViewer(viewer), params.videoId);
  if (!detail) notFound();
  const { video, stale } = detail;

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Induction videos', href: '/platform/dashboard/induction-videos' },
          {
            label: video.jobSite.name,
            href: `/platform/dashboard/sites/${video.jobSiteId}/induction-video`,
          },
          { label: `Version ${video.version}` },
        ]}
      />
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            Induction script · version {video.version}
          </h1>
          <p className="text-sm text-ink-muted">{video.jobSite.name}</p>
        </div>
        <span className="ml-auto">
          <InductionVideoStatusBadge status={video.status} stale={stale} />
        </span>
      </header>

      <VideoVersionSurface
        detail={detail}
        apiBase={`/api/platform/induction-video/${video.id}`}
        projectHref={`/platform/dashboard/sites/${video.jobSiteId}/induction-video`}
      />
    </PlatformShell>
  );
}
