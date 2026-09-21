import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Chivo, Crimson_Pro } from 'next/font/google';
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
import { formatDateUK } from '@/lib/datetime';

/*
 * THE ONLY WEBFONTS IN THE PRODUCT, AND DELIBERATELY SCOPED TO THIS ROUTE.
 *
 * Everything else in SiteComply runs on the system stack, which is the right
 * call for a worker checking in on site over mobile data. This page is the
 * opposite case: a formal document read on a desktop by a manager, a client or
 * an auditor, where the typography IS the deliverable. `next/font` self-hosts,
 * so there is no third-party request and no CSP surface — and because the
 * variables are applied to this page's document only, the operative's phone
 * never downloads them.
 *
 * Chivo carries apparatus (labels, numbers, headings); Crimson Pro carries the
 * prose. A serif body at a 60-odd character measure is what makes a construction
 * phase plan read as a document rather than a screen.
 */
const chivo = Chivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--cpp-sans',
  display: 'swap',
});
const crimson = Crimson_Pro({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--cpp-serif',
  display: 'swap',
});

export const dynamic = 'force-dynamic';

/**
 * SC-019 Phase 2 — Construction Phase Plan DRAFT.
 *
 * A structured view assembled entirely from data already captured in Project
 * Setup and Site Information.
 *
 * THIS SCREEN IS THE WORKING VIEW, NOT THE CONTROLLED DOCUMENT. An issued
 * revision is downloaded as a server-rendered PDF — see
 * services/sites/cppPdf — because window.print() stamps the browser's own page
 * title, URL, timestamp and page count onto the output, and those are a setting
 * in each reader's print dialog that no stylesheet can reach.
 *
 * (This comment previously said "No server-side PDF engine: the whole product
 * prints to PDF through the browser (permits, induction records)". That stopped
 * being true when the induction record got a real PDF, and the CPP's approach
 * was still resting on it.)
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
                  ? `Revision ${viewingRevision.version} · current`
                  : viewingRevision.status === 'SUPERSEDED'
                    ? `Revision ${viewingRevision.version} · superseded`
                    : `Revision ${viewingRevision.version} · prepared`
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
          {/* THE CONTROLLED ARTEFACT vs A WORKING VIEW.
             
              An ISSUED revision is downloaded as a server-rendered PDF: real
              running heads, true page numbers, and none of the browser's own
              URL/title/timestamp furniture, which is a print-dialog setting no
              stylesheet can reach.

              A DRAFT still prints from the browser, and the label says so. It is
              a working view, not something to send a client — giving it a
              download that looked identical to an approved plan is exactly what
              document control exists to prevent. */}
          {viewingRevision &&
          (viewingRevision.status === 'ISSUED' ||
            viewingRevision.status === 'SUPERSEDED') ? (
            <a
              href={`/api/platform/sites/${cpp.site.id}/cpp-revisions/${viewingRevision.id}/pdf`}
              className="touch-target rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90"
            >
              {`Download Revision ${String(viewingRevision.version).padStart(2, '0')} (PDF)`}
            </a>
          ) : (
            <div className="w-44">
              <PrintButton label="Print draft (browser)" />
            </div>
          )}
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

      {/* ---------------- The document itself ----------------

          A DELIBERATE DEPARTURE from the app's visual language, and the only
          one in the product. Everything else here is a screen a manager
          operates; this is a controlled document a client, a Principal
          Contractor or an HSE inspector reads.

          Monochrome by design: hierarchy is carried by rule weight, type weight
          and space rather than colour, which is what makes a printed
          construction document read as authoritative instead of generated. The
          only colour is one dark SiteComply blue on document control, and a
          muted amber on outstanding items — both information, not decoration.

          Styles live under .cpp-doc in globals.css so they cannot leak into the
          app, and the two webfonts are scoped to this route so the operative's
          phone never downloads them. `print:max-w-none` stays: on paper the page
          IS the measure. */}
      <article
        className={`cpp-doc ${chivo.variable} ${crimson.variable} mx-auto max-w-4xl border border-line px-12 py-12 shadow-card print:max-w-none print:border-0 print:p-0 print:shadow-none`}
      >
        <header>
          {/* PROVENANCE MARK. Where the document was produced — not who issues
              it. It sits ABOVE the contractor's rule, outside the masthead
              proper, because a mark placed level with or ahead of the
              contractor reads as the issuer, and a Construction Phase Plan is
              the Principal Contractor's statutory document.

              30px: the wordmark's lettering is 51% of the artwork's height, so
              at 30px the word stands about 15px and clears the contractor's own
              12px line — enough to register at a glance. It stays far short of
              the 42px title and the 23px revision number, which keep the page.

              Full colour deliberately. The artwork is blue and green; a greyed
              brand mark reads as a printing fault rather than restraint. This
              is not a banner, rule or tint, and nothing else was added with it.

              A plain <img> rather than next/image, for the same reason as the
              colophon: a fixed-height mark in a document that must print
              predictably. */}
          <div className="cpp-provenance">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sitecomply-logo.png" alt="SiteComply" width={67} height={30} />
          </div>

          {/* The document is the Principal Contractor's. Their name leads it. */}
          <div className="cpp-issuer">
            <span>{cpp.site.principalContractor ?? cpp.site.name}</span>
            <span className="ref">Job {cpp.site.jobReference}</span>
          </div>

          <p className="cpp-doctype">Construction Phase Plan — CDM 2015</p>
          <h1 className="cpp-title">{cpp.site.name}</h1>
          {cpp.site.address && <p className="cpp-site">{cpp.site.address}</p>}

          {/* REVISION AND STATUS. The most important fact on the page, given
              weight and air rather than a coloured box — and stated in document
              control language, not application language. */}
          <div className="cpp-status">
            <span className="rev">
              {viewingRevision
                ? `Revision ${String(viewingRevision.version).padStart(2, '0')}`
                : 'Working draft'}
            </span>
            <span className="state">
              {viewingRevision?.status === 'ISSUED'
                ? 'Current revision'
                : viewingRevision?.status === 'SUPERSEDED'
                  ? 'Superseded'
                  : viewingRevision
                    ? 'Prepared — not yet issued'
                    : 'Not yet issued'}
            </span>
            <span className="when">
              {viewingRevision?.issuedAt
                ? `Issued ${formatDateUK(viewingRevision.issuedAt)}`
                : viewingRevision
                  ? `Prepared ${formatDateUK(viewingRevision.preparedAt)}`
                  : `Assembled ${formatDateUK(cpp.meta.generatedAt)}`}
            </span>
          </div>

          <dl className="cpp-control">
            <div className="row">
              <dt>Prepared by</dt>
              <dd>{viewingRevision ? viewingRevision.preparedByName : cpp.meta.generatedByName}</dd>
            </div>
            <div className="row">
              <dt>Approved by</dt>
              <dd>
                {viewingRevision?.signedName ??
                  viewingRevision?.issuedByName ??
                  'Not yet approved'}
              </dd>
            </div>
            <div className="row">
              <dt>Principal Designer</dt>
              <dd>
                {cpp.sections
                  .find((x) => x.key === 'duty-holders')
                  ?.entries.find((e) => e.label === 'Principal Designer')?.value ??
                  'Not recorded'}
              </dd>
            </div>
            <div className="row">
              <dt>Information updated</dt>
              <dd>
                {cpp.meta.lastUpdatedAt
                  ? formatDateUK(cpp.meta.lastUpdatedAt)
                  : 'Not yet recorded'}
              </dd>
            </div>
            {/* Live setup progress. Omitted against a frozen revision, where it
                would report TODAY's completeness beside a historic document. */}
            {!viewingRevision && (
              <div className="row">
                <dt>Sections complete</dt>
                <dd>
                  {cpp.completeness.completed} of {cpp.completeness.applicable}
                </dd>
              </div>
            )}
            {!viewingRevision && (
              <div className="row">
                <dt>Status</dt>
                <dd>
                  {cpp.completeness.cppReady
                    ? 'All required sections recorded'
                    : `${cpp.outstanding.length} section${cpp.outstanding.length === 1 ? '' : 's'} outstanding`}
                </dd>
              </div>
            )}
          </dl>

          {/* The amber draft callout was here. It said three things the opening
              already says — the heading reads "Working draft", the status line
              reads "Not yet issued", and the control block shows no approver —
              and it put a coloured block at the top of a document that earns its
              authority from restraint.

              ONE SENTENCE OF IT WAS NOT DUPLICATED: the CDM 2015 duty, that the
              Principal Contractor remains responsible for the plan being
              suitable and sufficient. Software can assemble a plan; it cannot
              warrant that the plan is adequate, and the document must keep
              saying so. That sentence moved into the approval block, which is
              where approval and responsibility are already being discussed. */}
        </header>

        {/* CONTENTS. Part of the document, not chrome: a real issued plan has
            one, an auditor uses it to navigate a paper copy, and it prints.

            DELIBERATELY NO PAGE NUMBERS. A scrolling view cannot know where a
            sheet breaks, and a contents page citing a page the PDF then
            contradicts is a document-control defect rather than a convenience.
            Section numbers navigate both paper and screen. On screen each entry
            is an anchor; in print it is plain text. */}
        <nav className="cpp-contents" aria-label="Contents">
          <h2>Contents</h2>
          <ol>
            {sections.map((s, idx) => (
              <li key={s.key}>
                <span className="n">{idx + 1}.0</span>
                <a href={`#cpp-${s.key}`}>{s.title}</a>
              </li>
            ))}
            <li>
              <span className="n">{sections.length + 1}.0</span>
              <a href="#cpp-drawings">Drawings and emergency plans</a>
            </li>
            <li>
              <span className="n">{sections.length + 2}.0</span>
              <a href="#cpp-approval">Duty holder approval</a>
            </li>
          </ol>
        </nav>

        <main className="cpp-body" style={{ marginTop: '44px' }}>
          {sections.map((s, idx) => (
            <div className="cpp-section" key={s.key} id={`cpp-${s.key}`}>
              <div className="cpp-no">{idx + 1}.0</div>
              <div>
                <h2 className="cpp-h">{s.title}</h2>
                {!s.gatesCompletion && s.entries.length > 0 && s.entries[0]?.value && (
                  <p className="cpp-origin">{s.entries[0].label}</p>
                )}

                {s.items.length > 0 && (
                  <ul className="cpp-items">
                    {s.items.map((it, i) => (
                      <li key={`${i}-${it.label}`}>
                        <span>{it.label}</span>
                        {it.detail && <span className="detail">{it.detail}</span>}
                      </li>
                    ))}
                  </ul>
                )}

                {s.entries
                  .filter((e) => e.value !== null)
                  .filter((e) => s.gatesCompletion || s.items.length > 0 || e !== s.entries[0])
                  .map((e) => (
                    <div key={e.label} style={{ marginBottom: '13px' }}>
                      <p className="cpp-lab">{e.label}</p>
                      <p className="cpp-p" style={{ whiteSpace: 'pre-line' }}>
                        {e.value}
                      </p>
                    </div>
                  ))}

                {s.items.length === 0 &&
                  s.entries.every((e) => e.value === null) && (
                    <p className="cpp-p cpp-na">
                      {s.gatesCompletion ? 'Not yet recorded.' : 'None recorded.'}
                    </p>
                  )}

                {s.status === 'PARTIAL' && s.missing.length > 0 && (
                  <p className="cpp-flag">
                    Section incomplete. Still required: {s.missing.join(', ')}.
                  </p>
                )}
              </div>
            </div>
          ))}

          <div className="cpp-section" id="cpp-drawings">
            <div className="cpp-no">{sections.length + 1}.0</div>
            <div>
              <h2 className="cpp-h">Drawings and emergency plans</h2>
              {drawings.length === 0 ? (
                <p className="cpp-p cpp-na">
                  No site layout drawings or emergency plans are filed for this
                  project.
                </p>
              ) : (
                <ul className="cpp-items">
                  {drawings.map((d) => (
                    <li key={d.id}>
                      <span>{d.title}</span>
                      <span className="detail">{d.fileName}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="cpp-p" style={{ marginTop: '10px' }}>
                Drawings are held in the site&rsquo;s document register and issued
                alongside this plan.
              </p>
            </div>
          </div>

          {/* APPROVAL. The heaviest rule on the page, then air, then the
              signature. No frame — the rule does the work. */}
          <div className="cpp-approval" id="cpp-approval">
            <h2 className="cpp-h" style={{ fontSize: '20px', marginBottom: '5px' }}>
              Duty holder approval
            </h2>
            <p className="meta">
              {viewingRevision?.status === 'ISSUED' ||
              viewingRevision?.status === 'SUPERSEDED'
                ? `Revision ${String(viewingRevision.version).padStart(2, '0')} · approved and issued ${
                    viewingRevision.issuedAt
                      ? formatDateUK(viewingRevision.issuedAt)
                      : ''
                  }`
                : 'Approval is recorded when a revision is issued'}
            </p>

            {viewingRevision?.status === 'ISSUED' ||
            viewingRevision?.status === 'SUPERSEDED' ? (
              <>
                {viewingRevision.declarationText && (
                  <p className="cpp-decl">{viewingRevision.declarationText}</p>
                )}
                <dl className="cpp-who">
                  <div>
                    <dt>Approved by</dt>
                    <dd>
                      {viewingRevision.signedName ??
                        viewingRevision.issuedByName ??
                        'Not recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt>Position</dt>
                    <dd>
                      {viewingRevision.approverRole
                        ? viewingRevision.approverRole
                            .replace(/_/g, ' ')
                            .toLowerCase()
                            .replace(/^./, (c) => c.toUpperCase())
                        : 'Not recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>
                      {viewingRevision.issuedAt
                        ? formatDateUK(viewingRevision.issuedAt)
                        : 'Not recorded'}
                    </dd>
                  </div>
                </dl>
                <div style={{ maxWidth: '330px' }}>
                  {viewingRevision.signatureType === 'DRAWN' ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/platform/sites/${cpp.site.id}/cpp-revisions/${viewingRevision.id}/signature`}
                      alt={`Signature of ${viewingRevision.signedName ?? 'the approver'}`}
                      style={{ height: '58px', width: 'auto', display: 'block' }}
                    />
                  ) : viewingRevision.signedName ? (
                    <span className="cpp-sig">{viewingRevision.signedName}</span>
                  ) : (
                    <span className="cpp-sigline" />
                  )}
                  <p className="cpp-sigcap">
                    {viewingRevision.signedName
                      ? 'Signature of approver'
                      : 'Issued before approval records were captured'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="cpp-decl">
                  This plan has not been approved or issued. The Principal
                  Contractor remains responsible for ensuring the construction
                  phase plan is suitable, sufficient and kept up to date; the
                  approval is recorded here once a revision is issued.
                </p>
                <dl className="cpp-who">
                  <div><dt>Approved by</dt><dd className="cpp-sigline" /></div>
                  <div><dt>Position</dt><dd className="cpp-sigline" /></div>
                  <div><dt>Date</dt><dd className="cpp-sigline" /></div>
                </dl>
              </>
            )}
          </div>

          {/* COLOPHON — a publisher's imprint, and the whole of the SiteComply
              identity in this document. The reference sits left, the producing
              mark right.

              THE GENUINE ARTWORK, not a drawn substitute. The mark previously
              here was a closed blue ring with a dark blue tick — wrong
              construction and wrong colours against the real logo, which is the
              lowercase wordmark with an OPEN ring and a green tick. This is
              `public/sitecomply-logo.png`, the same asset the Logo component
              uses across the platform.

              A plain <img> rather than next/image: this is a fixed-height mark
              in a document that must print predictably, and the wrapper markup
              next/image adds earns nothing here. */}
          <div className="cpp-foot">
            <span className="ref">
              {cpp.site.jobReference} · Construction Phase Plan
              {viewingRevision
                ? ` · Revision ${String(viewingRevision.version).padStart(2, '0')}`
                : ' · Working draft'}
            </span>
            <span className="imprint">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/sitecomply-logo.png" alt="SiteComply" width={58} height={26} />
              <span>Prepared and issued in SiteComply</span>
            </span>
          </div>
        </main>
      </article>
    </PlatformShell>
  );
}
