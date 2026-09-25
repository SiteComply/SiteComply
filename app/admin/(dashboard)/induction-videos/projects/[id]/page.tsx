import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import {
  listVideosForSite,
  readinessForSite,
} from '@/services/inductionVideo/inductionVideoService';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
import { GenerateScriptButton } from '@/components/platform/GenerateScriptButton';
import { formatDateTimeUK } from '@/lib/datetime';
import { RefreshWhileWorking } from '@/components/inductionVideo/RefreshWhileWorking';
import { anyWorking, describeAnyWork } from '@/services/inductionVideo/videoProgress';

export const dynamic = 'force-dynamic';

/**
 * One project's induction videos, in the Admin Centre.
 *
 * The same two things the Platform's project page leads with: what the next
 * version would be built from — and what is missing, which is the usual reason a
 * video cannot be generated — then every version so far.
 *
 * GENERATING IS ALSO REGENERATING. There is no separate "regenerate": a new
 * version is requested and the previous one is kept as history, so the record of
 * what an operative was shown in March survives the April rewrite.
 *
 * An OWNER or ADMIN may generate; a VIEWER sees the same information with the
 * button withheld, and the route and service both refuse them regardless.
 */
export default async function AdminProjectInductionVideoPage({
  params,
}: {
  params: { id: string };
}) {
  const session = getAdminSession();
  if (!session) redirect('/admin/login');

  const actor = videoActorFromAdmin(session);
  const [videos, readiness] = await Promise.all([
    listVideosForSite(actor, params.id),
    readinessForSite(actor, params.id),
  ]);
  if (!videos || !readiness) notFound();

  const { manifest, siteName } = readiness;
  const manages = adminCanManage(session.role);
  const required = manifest.scenes.filter((s) => s.required);
  const optional = manifest.scenes.filter((s) => !s.required);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/induction-videos"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Induction videos
        </Link>
        <h1 className="text-2xl font-bold text-ink">
          {siteName} · induction video
        </h1>
        <p className="text-ink-muted">
          Built from this project’s own records, plus the company modules every
          induction carries.
        </p>
      </header>

      <RefreshWhileWorking
        working={anyWorking(videos)}
        label={describeAnyWork(videos)}
      />

      {manifest.missing.length > 0 && (
        <section className="rounded-xl border border-danger-500/40 bg-danger-50 p-4">
          <h2 className="text-sm font-bold text-danger-700">
            Information required before a video can be generated
          </h2>
          <ul className="mt-2 space-y-1">
            {manifest.missing.map((m) => (
              <li key={m.sceneType} className="text-sm text-danger-700">
                <span className="font-semibold">{m.heading}:</span> {m.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">
            Scenes this project requires ({required.length} required,{' '}
            {optional.length} optional)
          </h2>
          {manages && (
            <GenerateScriptButton
              siteId={params.id}
              endpoint={`/api/admin/sites/${params.id}/induction-video`}
              disabled={!manifest.canGenerate}
            />
          )}
        </div>

        <ul className="mt-3 divide-y divide-line">
          {manifest.scenes.map((s) => (
            <li key={s.sceneType} className="flex flex-wrap items-baseline gap-2 py-2">
              <span className="font-semibold text-ink">{s.heading}</span>
              {s.required ? (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                  Required
                </span>
              ) : (
                <span className="text-xs text-ink-subtle">Optional</span>
              )}
              {s.source === 'MODULE' && (
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-subtle">
                  Company standard
                </span>
              )}
            </li>
          ))}
        </ul>

        {manifest.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3">
            {manifest.warnings.map((w) => (
              <li key={w} className="text-xs text-ink-muted">
                {w}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">Versions</h2>
        {videos.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No version has been generated for this project yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {videos.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Link
                  href={`/admin/induction-videos/${v.id}`}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  Version {v.version}
                </Link>
                <InductionVideoStatusBadge status={v.status} stale={v.stale} />
                <span className="text-xs text-ink-subtle">
                  {v.sceneCount} {v.sceneCount === 1 ? 'scene' : 'scenes'}
                </span>
                <span className="ml-auto text-xs text-ink-subtle">
                  {v.approvedAt
                    ? `Approved ${formatDateTimeUK(v.approvedAt)}`
                    : v.generatedAt
                      ? `Generated ${formatDateTimeUK(v.generatedAt)}`
                      : 'Not generated'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
