import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { getVideo } from '@/services/inductionVideo/inductionVideoService';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
import { VideoVersionSurface } from '@/components/inductionVideo/VideoVersionSurface';

export const dynamic = 'force-dynamic';

/**
 * One version of an induction video, in the Admin Centre — fully actionable.
 *
 * The same working surface the Platform renders, over the same data, driven by the
 * same shared dispatcher: script review and editing, approval, narration,
 * rendering, publishing, withdrawal. An Admin Centre OWNER or ADMIN has authority
 * equivalent to a Platform Director here, by the owner's decision; a VIEWER can
 * read the version but every action is refused, by the route and again by the
 * service.
 *
 * Authority comes from `videoActorFromAdmin`, which answers "yes" for every
 * project rather than testing an assigned-sites list an admin does not have.
 */
export default async function AdminInductionVideoVersionPage({
  params,
}: {
  params: { videoId: string };
}) {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  const detail = await getVideo(videoActorFromAdmin(session), params.videoId);
  if (!detail) notFound();
  const { video, stale } = detail;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/admin/induction-videos/projects/${video.jobSiteId}`}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← {video.jobSite.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">
            Induction script · version {video.version}
          </h1>
          <span className="ml-auto">
            <InductionVideoStatusBadge status={video.status} stale={stale} />
          </span>
        </div>
        <p className="text-ink-muted">{video.jobSite.name}</p>
      </header>

      <VideoVersionSurface
        detail={detail}
        apiBase={`/api/admin/induction-video/${video.id}`}
        projectHref={`/admin/induction-videos/projects/${video.jobSiteId}`}
      />
    </div>
  );
}
