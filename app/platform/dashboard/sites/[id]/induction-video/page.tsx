import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageInductionVideos } from '@/services/inductionVideo/inductionVideoPermissions';
import {
  listVideosForSite,
  readinessForSite,
} from '@/services/inductionVideo/inductionVideoService';
import { formatDateTimeUK } from '@/lib/datetime';
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
import { GenerateScriptButton } from '@/components/platform/GenerateScriptButton';
import { SiteInductionModules } from '@/components/platform/SiteInductionModules';
import {
  canIssueInductionModule,
  moduleDecisionsForSite,
} from '@/services/inductionModules/inductionModuleService';

export const dynamic = 'force-dynamic';

/**
 * One project's induction video: what it would be built from, what is missing,
 * and every version so far.
 *
 * Steps 1 and 2 of the specification's wizard are one page on purpose. They
 * answer the same question — "can this project produce an induction, and from
 * what?" — and splitting them would make a manager click to find out that they
 * cannot proceed.
 */
export default async function SiteInductionVideoPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  if (!canManageInductionVideos(viewer.role)) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const [readiness, videos] = await Promise.all([
    readinessForSite(viewer, params.id),
    listVideosForSite(viewer, params.id),
  ]);
  if (!readiness || !videos) notFound();

  const { manifest, sourceSummary, siteName } = readiness;
  /*
   * The overlap note needs to know what this project's own records already
   * produce — the readiness manifest is exactly that, so the panel and the
   * generated script agree about which module is displaced.
   */
  const moduleDecisions = await moduleDecisionsForSite(
    params.id,
    manifest.scenes.map((s) => s.sceneType),
  );
  const required = manifest.scenes.filter((s) => s.required);
  const optional = manifest.scenes.filter((s) => !s.required);

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Induction videos', href: '/platform/dashboard/induction-videos' },
          { label: siteName },
        ]}
      />
      <header className="mb-5 space-y-1">
        <h1 className="text-2xl font-bold text-ink">Induction video</h1>
        <p className="text-sm text-ink-muted">{siteName}</p>
      </header>

      {/* STEP 2 FIRST WHEN IT BLOCKS. A manager who cannot generate should meet
          the reason before the inventory of what they do have. */}
      {manifest.missing.length > 0 && (
        <section className="mb-5 rounded-xl border border-danger-500/40 bg-danger-50 p-4">
          <h2 className="text-sm font-bold text-danger-700">
            This project cannot produce an induction video yet
          </h2>
          <ul className="mt-2 space-y-2">
            {manifest.missing.map((m) => (
              <li key={m.sceneType} className="text-sm text-danger-700">
                <span className="font-semibold">{m.heading}:</span> {m.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SiteInductionModules
        siteId={params.id}
        modules={moduleDecisions.map((m) => ({
          ...m,
          state: m.state as 'INCLUDED' | 'EXCLUDED' | 'OVERRIDDEN' | null,
        }))}
        canOverride={canIssueInductionModule(viewer.role)}
      />

      <section className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">What the video would be built from</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <Fact label="Significant risks" value={sourceSummary.risks} />
          <Fact label="Site rules" value={sourceSummary.siteRules} />
          <Fact label="PPE items" value={sourceSummary.ppe} />
          <Fact label="RAMS" value={sourceSummary.rams} />
          <Fact label="Permit types" value={sourceSummary.permits} />
          <Fact label="Site map" value={sourceSummary.hasSiteMap ? 'Yes' : 'No'} />
        </dl>
        <p className="mt-3 text-xs text-ink-subtle">
          Only information recorded against this project is used. Nothing is
          invented, and an entry that says nothing — “N/A”, “TBC”, a question
          left in the box — is treated as unanswered.
        </p>
      </section>

      <section className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">
            Scenes this project requires ({required.length} required,{' '}
            {optional.length} optional)
          </h2>
          <GenerateScriptButton siteId={params.id} disabled={!manifest.canGenerate} />
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
              <span className="ml-auto text-xs text-ink-subtle">
                {s.sourceRefs.join(', ') || '—'}
              </span>
            </li>
          ))}
        </ul>

        {manifest.warnings.length > 0 && (
          <div className="mt-3 rounded-lg bg-surface-sunken px-3 py-2">
            <p className="text-xs font-semibold text-ink">Worth knowing</p>
            <ul className="mt-1 space-y-1">
              {manifest.warnings.map((w) => (
                <li key={w} className="text-xs text-ink-muted">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">Versions</h2>
        {videos.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No induction video has been generated for this project yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {videos.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Link
                  href={`/platform/dashboard/induction-videos/${v.id}`}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  Version {v.version}
                </Link>
                <InductionVideoStatusBadge status={v.status} stale={v.stale} />
                <span className="text-xs text-ink-muted">
                  {v.sceneCount} scene{v.sceneCount === 1 ? '' : 's'}
                </span>
                {v.supersededAt && (
                  <span className="text-xs text-ink-subtle">
                    Superseded {formatDateTimeUK(v.supersededAt)}
                  </span>
                )}
                <span className="ml-auto text-xs text-ink-subtle">
                  {v.approvedAt
                    ? `Approved ${formatDateTimeUK(v.approvedAt)} · ${v.approvedByName ?? ''}`
                    : v.generatedAt
                      ? `Generated ${formatDateTimeUK(v.generatedAt)}`
                      : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-subtle">
          Superseded versions are kept: an operative inducted against an earlier
          version must still be able to be shown what it said.
        </p>
      </section>
    </PlatformShell>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-surface-sunken px-3 py-2">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
