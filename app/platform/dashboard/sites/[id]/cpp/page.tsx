import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { PrintButton } from '@/components/worker/PrintButton';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { getCppDraft } from '@/services/sites/cppService';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * SC-019 Phase 2 — Construction Phase Plan DRAFT.
 *
 * A structured, print-optimised view assembled entirely from data already
 * captured in Project Setup and Site Information. No server-side PDF engine: the
 * whole product prints to PDF through the browser (permits, induction records),
 * and a CPP is no different.
 *
 * Read-only. There is no editing here at all, which is how the Phase 1
 * Director/Site Manager ownership split is preserved — you change a section by
 * going back to the wizard step that owns it.
 */
export default async function SiteCppPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  const cpp = await getCppDraft(viewer, params.id);
  if (!cpp) notFound();

  const setupHref = `/platform/dashboard/sites/${cpp.site.id}/setup`;

  return (
    <PlatformShell>
      <div className="print:hidden">
        <Breadcrumbs
          items={[
            { label: 'Sites', href: '/platform/dashboard/sites' },
            {
              label: cpp.site.name,
              href: `/platform/dashboard/sites/${cpp.site.id}`,
            },
            { label: 'Construction Phase Plan' },
          ]}
        />
      </div>

      {/* Screen-only controls. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink">
            Construction Phase Plan — draft
          </h1>
          <p className="text-sm text-ink-muted">
            Assembled from Project Setup. Nothing here is entered twice.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={setupHref}
            className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Edit in Project setup
          </Link>
          <div className="w-44">
            <PrintButton label="Print / save as PDF" />
          </div>
        </div>
      </div>

      {/* Gap list — screen only. A plan with silent holes is worse than one that
          says what is missing, so this is shown before the document itself. */}
      {cpp.outstandingTitles.length > 0 && (
        <div className="mb-4 rounded-xl border border-hivis-500/40 bg-hivis-500/10 p-4 print:hidden">
          <p className="text-sm font-semibold text-ink">
            {cpp.outstandingTitles.length} section
            {cpp.outstandingTitles.length === 1 ? '' : 's'} not yet recorded
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-muted">
            {cpp.outstandingTitles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <Link
            href={setupHref}
            className="mt-2 inline-flex text-sm font-semibold text-brand-700 hover:underline"
          >
            Complete these in Project setup →
          </Link>
        </div>
      )}

      {/* ---------------- The document itself ---------------- */}
      {/* UX REFRESH PHASE 7 — the one place in this refresh where LESS width is
          the improvement. Everywhere else the brief's "use more page width" is
          right, because those screens are dashboards, registers and workspaces.
          This is a formal document a duty-holder reads end to end, and prose set
          across 1600px is genuinely hard to follow — measure is readability, not
          decoration. The document gets a comfortable measure and centres in the
          wider frame.

          `print:max-w-none` matters: on paper the page IS the measure, so the
          screen cap must not also constrain the printed CPP. */}
      <article className="mx-auto max-w-5xl rounded-xl border border-line bg-surface p-6 shadow-card print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* DRAFT status is stated on screen AND in print. Software can assemble a
            CPP; it cannot warrant that the plan is adequate — that is the
            Principal Contractor's duty under CDM 2015. */}
        <div className="mb-5 rounded-lg border-2 border-hivis-500 bg-hivis-500/10 p-3 print:rounded-none">
          <p className="text-sm font-bold uppercase tracking-wide text-ink">
            Draft — for duty holder review and approval
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            This document has been assembled automatically from the information
            recorded in SiteComply. It is a starting point, not an approved
            plan. The Principal Contractor remains responsible under the
            Construction (Design and Management) Regulations 2015 for ensuring
            the construction phase plan is suitable, sufficient and kept up to
            date. Review, amend and approve before issue.
          </p>
        </div>

        <header className="mb-6 border-b border-line pb-4">
          <h2 className="text-2xl font-bold text-ink">
            Construction Phase Plan
          </h2>
          <p className="mt-1 text-base font-semibold text-ink">
            {cpp.site.name}
          </p>
          <p className="text-sm text-ink-muted">
            Job reference {cpp.site.jobReference}
          </p>
          <p className="text-sm text-ink-muted">{cpp.site.address}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-ink-subtle sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">Draft generated: </dt>
              <dd className="inline">
                {formatDateTimeUK(cpp.meta.generatedAt)} by{' '}
                {cpp.meta.generatedByName}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">
                Information last updated:{' '}
              </dt>
              <dd className="inline">
                {cpp.meta.lastUpdatedAt
                  ? `${formatDateTimeUK(cpp.meta.lastUpdatedAt)}${
                      cpp.meta.lastUpdatedByName
                        ? ` by ${cpp.meta.lastUpdatedByName}`
                        : ''
                    }`
                  : 'Not yet recorded'}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Setup completeness: </dt>
              <dd className="inline">
                {cpp.completeness.completed} of {cpp.completeness.applicable}{' '}
                sections ({cpp.completeness.percent}%)
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Status: </dt>
              <dd className="inline">
                {cpp.completeness.cppReady
                  ? 'All required sections recorded'
                  : 'Incomplete — see outstanding sections'}
              </dd>
            </div>
          </dl>
        </header>

        <ol className="space-y-6">
          {cpp.sections.map((s, idx) => (
            <li key={s.key} className="break-inside-avoid">
              <h3 className="text-base font-bold text-ink">
                {idx + 1}. {s.title}
              </h3>
              {s.empty ? (
                <p className="mt-1 text-sm italic text-ink-subtle">
                  Not yet recorded.{' '}
                  <Link
                    href={setupHref}
                    className="font-semibold text-brand-700 underline print:hidden"
                  >
                    Complete in Project setup
                  </Link>
                </p>
              ) : (
                <dl className="mt-2 space-y-2">
                  {s.entries
                    .filter((e) => e.value !== null)
                    .map((e) => (
                      <div key={e.label}>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                          {e.label}
                        </dt>
                        <dd className="whitespace-pre-line text-sm text-ink">
                          {e.value}
                        </dd>
                      </div>
                    ))}
                </dl>
              )}
            </li>
          ))}

          <li className="break-inside-avoid">
            <h3 className="text-base font-bold text-ink">
              {cpp.sections.length + 1}. Drawings and emergency plans
            </h3>
            {cpp.drawings.length === 0 ? (
              <p className="mt-1 text-sm italic text-ink-subtle">
                No site layout drawings or emergency plans filed.
              </p>
            ) : (
              <ul className="mt-2 list-inside list-disc text-sm text-ink">
                {cpp.drawings.map((d) => (
                  <li key={d.id}>
                    {d.title}{' '}
                    <span className="text-ink-subtle">({d.fileName})</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-ink-subtle">
              Drawings are held in the site&apos;s document register and issued
              alongside this plan.
            </p>
          </li>
        </ol>

        {/* Approval block — printed, so a reviewer can sign the issued copy. */}
        <section className="mt-8 break-inside-avoid border-t border-line pt-4">
          <h3 className="text-base font-bold text-ink">
            Duty holder review and approval
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            To be completed by the Principal Contractor on review of this draft.
          </p>
          <div className="mt-4 grid gap-6 sm:grid-cols-3">
            {['Reviewed by', 'Position', 'Date'].map((label) => (
              <div key={label}>
                <div className="h-8 border-b border-ink-subtle" />
                <p className="mt-1 text-xs text-ink-subtle">{label}</p>
              </div>
            ))}
          </div>
        </section>
      </article>
    </PlatformShell>
  );
}
