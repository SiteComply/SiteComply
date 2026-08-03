import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { PrintButton } from '@/components/worker/PrintButton';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  canGenerateCloseOutPack,
  renderPack,
} from '@/services/closeOut/closeOutService';
import { formatDateUK, formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 1 — the generated pack: cover page, contents, numbered sections.
 *
 * Printed with the browser (window.print), the same approach SC-019 Phase 2
 * used for the CPP — no PDF library is introduced. Server-side PDF and ZIP are
 * a later phase.
 *
 * The pack RE-READS live records and re-checks permissions on every view, so an
 * older version opened by a different person shows only what THEY may see.
 */
export default async function CloseOutPackPage({
  params,
}: {
  params: { id: string; packId: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canGenerateCloseOutPack(viewer.role)) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const pack = await renderPack(viewer, params.packId);
  if (!pack) notFound();

  return (
    <PlatformShell>
      <div className="print:hidden">
        <Breadcrumbs
          items={[
            { label: 'Sites', href: '/platform/dashboard/sites' },
            {
              label: 'Close-out pack',
              href: `/platform/dashboard/sites/${params.id}/close-out`,
            },
            { label: `Version ${pack.version}.0` },
          ]}
        />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mt-1 text-2xl font-bold text-ink">{pack.title}</h1>
            <p className="text-ink-muted">
              Version {pack.version}.0 · generated{' '}
              {formatDateTimeUK(pack.generatedAt)} by {pack.generatedByName} · ~
              {pack.estimatedPages} pages
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/platform/dashboard/sites/${params.id}/close-out`}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              ← Back to generator
            </Link>
            <PrintButton label="Export as PDF (print)" />
          </div>
        </div>
      </div>

      <article className="rounded-2xl border border-line bg-surface p-8 print:border-0 print:p-0">
        {/* Cover page */}
        <header className="border-b border-line pb-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-700">
            SiteComply
          </p>
          <h2 className="mt-6 text-2xl font-bold uppercase text-ink">
            {pack.site.name}
          </h2>
          <p className="text-lg font-semibold uppercase text-ink-muted">
            Project Close-Out Pack
          </p>

          <dl className="mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-4 text-left text-sm">
            <div>
              <dt className="font-semibold text-ink">Project address</dt>
              <dd className="text-ink-muted">{pack.site.address}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Job reference</dt>
              <dd className="text-ink-muted">{pack.site.jobReference}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Prepared for</dt>
              <dd className="text-ink-muted">{pack.preparedFor ?? '—'}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Prepared by</dt>
              <dd className="text-ink-muted">{pack.generatedByName}</dd>
            </div>
          </dl>

          <p className="mt-6 text-xs text-ink-subtle">
            Generated on {formatDateUK(pack.generatedAt)} · Version{' '}
            {pack.version}.0
          </p>
        </header>

        {/* Contents — hyperlinked, per the requirement's "digital versions". */}
        <nav className="border-b border-line py-6">
          <h3 className="mb-2 text-base font-bold text-ink">Contents</h3>
          <ol className="list-decimal space-y-1 pl-6 text-sm">
            {pack.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-brand-700 hover:underline">
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* Numbered sections */}
        {pack.sections.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            className="border-b border-line py-6 last:border-0 print:break-before-page"
          >
            <h3 className="mb-3 text-base font-bold text-ink">
              {i + 1}. {s.label}
            </h3>

            {s.facts ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                {s.facts.map((f) => (
                  <div key={f.label}>
                    <dt className="text-xs font-semibold text-ink">
                      {f.label}
                    </dt>
                    <dd className="whitespace-pre-line text-sm text-ink-muted">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {s.rows && s.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-ink-subtle">
                    <tr>
                      {s.rows[0]!.map((c) => (
                        <th key={c.label} className="pb-1 pr-3 font-medium">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {s.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c) => (
                          <td key={c.label} className="py-1.5 pr-3 text-ink">
                            {c.value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {s.photos ? (
              <ul className="grid grid-cols-2 gap-2 text-xs text-ink-muted sm:grid-cols-3">
                {s.photos.map((p) => (
                  <li key={p.id} className="rounded border border-line p-2">
                    {p.caption}
                  </li>
                ))}
              </ul>
            ) : null}

            {s.rows && s.rows.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                No records of this type for this project.
              </p>
            ) : null}

            {s.cappedNote ? (
              <p className="mt-2 rounded border border-hivis-500/40 bg-hivis-500/10 px-3 py-2 text-xs text-ink-muted">
                {s.cappedNote}
              </p>
            ) : null}
          </section>
        ))}

        {/* The honesty footer, following SC-019's CPP: this is a compilation of
            records, not a certificate of compliance. */}
        <footer className="pt-6 text-xs text-ink-subtle">
          <p>
            This pack was compiled automatically from the records held in
            SiteComply for this project on {formatDateUK(pack.generatedAt)}. It
            is a record of what was captured, not an assessment or certification
            of compliance. The Principal Contractor remains responsible for the
            accuracy and completeness of project records under CDM 2015.
          </p>
        </footer>
      </article>
    </PlatformShell>
  );
}
