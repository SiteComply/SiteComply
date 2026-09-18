import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { PrintButton } from '@/components/worker/PrintButton';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { getCppDraft } from '@/services/sites/cppService';
import {
  getRevisionState,
  getRevision,
  CPP_APPROVAL_DECLARATION,
} from '@/services/sites/cppRevisionService';
import { CppRevisionBar } from '@/components/platform/CppRevisionBar';
import { permits, canIssueCpp } from '@/services/platformUsers/platformPermissions';
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
  searchParams,
}: {
  params: { id: string };
  searchParams: { revision?: string };
}) {
  const viewer = await requirePlatformViewer();
  const cpp = await getCppDraft(viewer, params.id);
  if (!cpp) notFound();

  /*
   * THE LIVE DRAFT IS STILL ASSEMBLED EVERY TIME. Document control did not turn
   * the CPP into stored data — it added frozen revisions ALONGSIDE the live
   * view, and the revision state compares the two. Everything below renders the
   * live draft unless a specific revision was asked for.
   */
  const revisionState = await getRevisionState(viewer, params.id, cpp);
  const viewingRevision = searchParams.revision
    ? await getRevision(viewer, params.id, searchParams.revision)
    : null;

  // A frozen revision replaces the SECTIONS and drawings; the gap list and
  // completeness describe live setup progress and belong to the working draft,
  // so they are hidden when reading history rather than shown misleadingly.
  const sections = viewingRevision
    ? viewingRevision.snapshot.sections
    : cpp.sections;
  const drawings = viewingRevision
    ? viewingRevision.snapshot.drawings
    : cpp.drawings;

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

      {revisionState && (
        <CppRevisionBar
          siteId={cpp.site.id}
          issued={
            revisionState.issued
              ? {
                  id: revisionState.issued.id,
                  version: revisionState.issued.version,
                  status: revisionState.issued.status,
                  preparedByName: revisionState.issued.preparedByName,
                  issuedByName: revisionState.issued.issuedByName,
                  issuedAt: revisionState.issued.issuedAt?.toISOString() ?? null,
                }
              : null
          }
          draft={
            revisionState.draft
              ? {
                  id: revisionState.draft.id,
                  version: revisionState.draft.version,
                  status: revisionState.draft.status,
                  preparedByName: revisionState.draft.preparedByName,
                  issuedByName: null,
                  issuedAt: null,
                }
              : null
          }
          drift={revisionState.driftFromIssued}
          viewing={
            viewingRevision
              ? {
                  kind: 'REVISION',
                  version: viewingRevision.version,
                  status: viewingRevision.status,
                }
              : { kind: 'LIVE' }
          }
          canCreate={permits(viewer.role, 'sites', 'edit')}
          canIssue={canIssueCpp(viewer.role)}
          approverName={viewer.name}
          declaration={CPP_APPROVAL_DECLARATION}
          readiness={revisionState.readiness}
          setupHref={setupHref}
        />
      )}

      {/* Screen-only controls. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="min-w-0">
          {/* The heading said "— draft" unconditionally, directly beneath a bar
              that might be announcing Revision 2 as the version in force. Two
              headers that can contradict each other is worse than either alone,
              so this now follows what is actually being read. */}
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-ink">
            Construction Phase Plan
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                viewingRevision?.status === 'ISSUED'
                  ? 'bg-safe-50 text-safe-700'
                  : viewingRevision?.status === 'SUPERSEDED'
                    ? 'bg-surface-sunken text-ink-muted'
                    : 'bg-hivis-500/15 text-ink'
              }`}
            >
              {viewingRevision
                ? viewingRevision.status === 'ISSUED'
                  ? `Revision ${viewingRevision.version} · in force`
                  : viewingRevision.status === 'SUPERSEDED'
                    ? `Revision ${viewingRevision.version} · superseded`
                    : `Revision ${viewingRevision.version} · draft`
                : 'Working draft'}
            </span>
          </h1>
          <p className="text-sm text-ink-muted">
            {viewingRevision
              ? 'A dated snapshot. It cannot be edited — a change is made by issuing a further revision.'
              : 'Assembled from Project Setup. Nothing here is entered twice.'}
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
      {!viewingRevision && cpp.outstanding.length > 0 && (
        <div className="mb-4 rounded-xl border border-hivis-500/40 bg-hivis-500/10 p-4 print:hidden">
          <p className="text-sm font-semibold text-ink">
            {cpp.outstanding.length} section
            {cpp.outstanding.length === 1 ? '' : 's'} not yet complete
          </p>
          {/* A section that has been STARTED is a different problem from one
              nobody has touched, and the required information that is still
              missing is named rather than left to be hunted for. */}
          <ul className="mt-1 space-y-1 text-sm text-ink-muted">
            {cpp.outstanding.map((o) => (
              <li key={o.title}>
                <span className="font-medium text-ink">{o.title}</span>
                {o.status === 'PARTIAL' ? ' — started, incomplete' : ' — not recorded'}
                {o.missing.length > 0 && (
                  <span className="block text-xs text-ink-subtle">
                    Still needed: {o.missing.join(', ')}
                  </span>
                )}
              </li>
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
        {/* THE STATUS BANNER MUST MATCH WHAT IS BEING READ. It said "Draft"
            unconditionally, which was true when the CPP was only ever a live
            view. Printing "draft" across an issued revision — or "issued" across
            a working draft — would be the document lying about its own standing,
            which is the one thing document control cannot tolerate. */}
        <div
          className={`mb-5 rounded-lg border-2 p-3 print:rounded-none ${
            viewingRevision?.status === 'ISSUED'
              ? 'border-safe-500 bg-safe-50'
              : viewingRevision?.status === 'SUPERSEDED'
                ? 'border-ink-subtle bg-surface-sunken'
                : 'border-hivis-500 bg-hivis-500/10'
          }`}
        >
          <p className="text-sm font-bold uppercase tracking-wide text-ink">
            {viewingRevision?.status === 'ISSUED'
              ? `Issued — Revision ${viewingRevision.version}`
              : viewingRevision?.status === 'SUPERSEDED'
                ? `Superseded — Revision ${viewingRevision.version}`
                : viewingRevision
                  ? `Draft revision ${viewingRevision.version} — not yet issued`
                  : 'Working draft — for duty holder review and approval'}
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
              <dt className="inline font-semibold">
                {viewingRevision ? 'Revision prepared: ' : 'Draft generated: '}
              </dt>
              <dd className="inline">
                {viewingRevision
                  ? `${formatDateTimeUK(viewingRevision.preparedAt)} by ${viewingRevision.preparedByName}`
                  : `${formatDateTimeUK(cpp.meta.generatedAt)} by ${cpp.meta.generatedByName}`}
              </dd>
            </div>
            {viewingRevision?.issuedAt && (
              <div>
                <dt className="inline font-semibold">Issued: </dt>
                <dd className="inline">
                  {formatDateTimeUK(viewingRevision.issuedAt)}
                  {viewingRevision.issuedByName
                    ? ` by ${viewingRevision.issuedByName}`
                    : ''}
                </dd>
              </div>
            )}
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
            {/* Live setup progress. Hidden against a frozen revision, where it
                would report TODAY's completeness beside a historic document. */}
            {!viewingRevision && (
              <div>
                <dt className="inline font-semibold">Setup completeness: </dt>
                <dd className="inline">
                  {cpp.completeness.completed} of {cpp.completeness.applicable}{' '}
                  sections ({cpp.completeness.percent}%)
                </dd>
              </div>
            )}
            {!viewingRevision && (
            <div>
              <dt className="inline font-semibold">Status: </dt>
              {/* PRINTED, and previously the lie. This read "All required
                  sections recorded" whenever somebody had ticked the steps,
                  directly above a screen-only list naming the sections that were
                  missing. It is now the same computation as that list, and it
                  says HOW MANY are outstanding rather than only that some are. */}
              <dd className="inline">
                {cpp.completeness.cppReady
                  ? 'All required sections recorded'
                  : `Incomplete — ${cpp.outstanding.length} section${
                      cpp.outstanding.length === 1 ? '' : 's'
                    } outstanding`}
              </dd>
            </div>
            )}
          </dl>
        </header>

        <ol className="space-y-6">
          {sections.map((s, idx) => (
            <li key={s.key} className="break-inside-avoid">
              <h3 className="text-base font-bold text-ink">
                {idx + 1}. {s.title}
              </h3>
              {/* A REGISTER, where the section has one — site rules, PPE,
                  permit types, RAMS, inspections. Listed rather than squeezed
                  into prose, because that is what a reader scans for. */}
              {s.items.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {s.items.map((it, i) => (
                    <li key={`${i}-${it.label}`} className="flex gap-2 text-sm">
                      <span aria-hidden className="text-ink-subtle">
                        •
                      </span>
                      <span>
                        <span className="text-ink">{it.label}</span>
                        {it.detail && (
                          <span className="block text-xs text-ink-muted">
                            {it.detail}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {s.items.length === 0 &&
              s.entries.every((e) => e.value === null) ? (
                <p className="mt-1 text-sm italic text-ink-subtle">
                  {/* A wired section is not a setup gap, so it must not send the
                      reader to the wizard for something the wizard cannot fix. */}
                  {s.gatesCompletion ? 'Not yet recorded.' : 'None recorded.'}{' '}
                  <Link
                    href={s.manageHref ?? setupHref}
                    className="font-semibold text-brand-700 underline print:hidden"
                  >
                    {s.gatesCompletion
                      ? 'Complete in Project setup'
                      : 'Manage this'}
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
              {s.status === 'PARTIAL' && (
                <p className="mt-2 border-l-2 border-hivis-500 pl-2 text-xs text-ink-muted">
                  Section incomplete. Still required: {s.missing.join(', ')}.
                </p>
              )}
            </li>
          ))}

          <li className="break-inside-avoid">
            <h3 className="text-base font-bold text-ink">
              {sections.length + 1}. Drawings and emergency plans
            </h3>
            {drawings.length === 0 ? (
              <p className="mt-1 text-sm italic text-ink-subtle">
                No site layout drawings or emergency plans filed.
              </p>
            ) : (
              <ul className="mt-2 list-inside list-disc text-sm text-ink">
                {drawings.map((d) => (
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

        {/* APPROVAL.
            This was three blank lines to be filled in with a pen after printing,
            which was the whole of the approval mechanism. On an ISSUED revision
            it is now the recorded act: who approved it, the authority they held
            at the time, the declaration they accepted and their signature. On a
            working draft it stays blank lines, because nothing has been
            approved and pretending otherwise is the failure being fixed. */}
        <section className="mt-8 break-inside-avoid border-t border-line pt-4">
          <h3 className="text-base font-bold text-ink">
            Duty holder review and approval
          </h3>
          {viewingRevision?.status === 'ISSUED' ||
          viewingRevision?.status === 'SUPERSEDED' ? (
            <div className="mt-2">
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline font-semibold">Approved by: </dt>
                  <dd className="inline">
                    {viewingRevision.signedName ??
                      viewingRevision.issuedByName ??
                      'Not recorded'}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Position: </dt>
                  <dd className="inline">
                    {viewingRevision.approverRole
                      ? viewingRevision.approverRole.replace(/_/g, ' ').toLowerCase()
                      : 'Not recorded'}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Date: </dt>
                  <dd className="inline">
                    {viewingRevision.issuedAt
                      ? formatDateTimeUK(viewingRevision.issuedAt)
                      : 'Not recorded'}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Revision: </dt>
                  <dd className="inline">{viewingRevision.version}</dd>
                </div>
              </dl>

              {viewingRevision.declarationText && (
                <p className="mt-3 border-l-2 border-line pl-3 text-xs text-ink-muted">
                  {viewingRevision.declarationText}
                </p>
              )}

              {viewingRevision.signatureType === 'DRAWN' ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/platform/sites/${cpp.site.id}/cpp-revisions/${viewingRevision.id}/signature`}
                  alt={`Signature of ${viewingRevision.signedName ?? 'the approver'}`}
                  className="mt-3 h-16 w-auto"
                />
              ) : viewingRevision.signedName ? (
                /* Same stack the induction record uses for a typed signature —
                   there is no Tailwind `font-signature` class, and inventing one
                   here would have rendered in the body face without erroring. */
                <p
                  className="mt-3 text-2xl text-ink"
                  style={{
                    fontFamily: '"Segoe Script", "Brush Script MT", cursive',
                  }}
                >
                  {viewingRevision.signedName}
                </p>
              ) : null}

              {/* An honest gap rather than a blank space. Revisions issued
                  before approval capture existed have no signature, and
                  back-filling one would invent evidence nobody gave. */}
              {!viewingRevision.signedName && (
                <p className="mt-3 text-xs italic text-ink-subtle">
                  This revision was issued before approval records were captured,
                  so no signature is held for it.
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-muted">
                This is a working draft. Approval is recorded when a revision is
                issued.
              </p>
              <div className="mt-4 grid gap-6 sm:grid-cols-3">
                {['Reviewed by', 'Position', 'Date'].map((label) => (
                  <div key={label}>
                    <div className="h-8 border-b border-ink-subtle" />
                    <p className="mt-1 text-xs text-ink-subtle">{label}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </article>
    </PlatformShell>
  );
}
