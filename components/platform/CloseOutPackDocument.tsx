import { formatDateUK } from '@/lib/datetime';
import type { renderPack } from '@/services/closeOut/closeOutService';
import type { CompanyBranding } from '@/services/company/companyConfigService';
import type { CloseOutNarrative } from '@/services/closeOut/closeOutNarrative';
import {
  AiBadge,
  AiNarrativeBlock,
  AiNarrativeNote,
} from '@/components/platform/AiNarrativeBlock';

type RenderedPack = NonNullable<Awaited<ReturnType<typeof renderPack>>>;

/**
 * SC-024 — the close-out pack document itself.
 *
 * ONE definition, rendered both inside the platform and on a shared link. A
 * client opening a share must see exactly the document the project team sees;
 * two copies of this markup would drift and the shared version is the one nobody
 * looks at internally.
 *
 * Presentational only — every permission decision has already been made by
 * whoever built `pack` and `labels`.
 */
export function CloseOutPackDocument({
  pack,
  branding,
  labels,
  narrative,
}: {
  pack: RenderedPack;
  branding: CompanyBranding;
  labels: { ref: string; title: string; source: string }[];
  narrative: CloseOutNarrative | null;
}) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-8 print:border-0 print:p-0">
      {/* Cover page */}
      <header className="border-b border-line pb-8 text-center">
        {branding.hasLogo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src="/api/company/logo"
            alt={branding.companyName}
            className="mx-auto mb-4 max-h-16 max-w-[220px] object-contain"
          />
        ) : null}
        <p
          className="text-sm font-bold uppercase tracking-widest"
          style={{ color: branding.primaryColor }}
        >
          {branding.companyName}
        </p>
        {branding.tagline ? (
          <p className="mt-1 text-xs text-ink-subtle">{branding.tagline}</p>
        ) : null}
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
          Generated on {formatDateUK(pack.generatedAt)} · Version {pack.version}
          .0
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
          {labels.length > 0 ? <li>Appendices</li> : null}
        </ol>
      </nav>

      {/* AI executive summary — clearly labelled, and immediately followed by
          the note stating it is descriptive only. */}
      {narrative ? (
        <div className="border-b border-line py-6">
          <AiNarrativeBlock title="Executive summary">
            <p className="whitespace-pre-line">{narrative.executiveSummary}</p>
          </AiNarrativeBlock>
          <AiNarrativeNote
            model={pack.aiModel}
            generatedAt={pack.aiGeneratedAt}
            generatedBy={pack.aiGeneratedBy}
          />
        </div>
      ) : null}

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

          {(() => {
            const n = narrative?.sectionNarratives.find(
              (x) => x.sectionId === s.id,
            );
            return n ? (
              <div className="mb-3 rounded border border-brand-700/30 bg-brand-700/5 p-3">
                <div className="mb-1">
                  <AiBadge />
                </div>
                <p className="text-sm leading-relaxed text-ink">
                  {n.narrative}
                </p>
              </div>
            ) : null;
          })()}

          {s.facts ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              {s.facts.map((f) => (
                <div key={f.label}>
                  <dt className="text-xs font-semibold text-ink">{f.label}</dt>
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

      {/* Supporting appendices — the register that ties this document to the
          original files in the ZIP export. Numbering is shared with the
          archive, so "Appendix A3" here is the file named A3 in the zip. */}
      {labels.length > 0 ? (
        <section className="border-t border-line py-6 print:break-before-page">
          <h3 className="mb-3 text-base font-bold text-ink">Appendices</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-subtle">
                <tr>
                  <th className="pb-1 pr-3 font-medium">Ref</th>
                  <th className="pb-1 pr-3 font-medium">Title</th>
                  <th className="pb-1 pr-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {labels.map((l) => (
                  <tr key={l.ref}>
                    <td className="py-1.5 pr-3 font-semibold text-ink">
                      {l.ref}
                    </td>
                    <td className="py-1.5 pr-3 text-ink">{l.title}</td>
                    <td className="py-1.5 pr-3 text-ink-muted">{l.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            The original files are included in the <code>originals/</code>{' '}
            folder of the ZIP export, named by their reference above.
          </p>
        </section>
      ) : null}

      {/* The honesty footer, following SC-019's CPP: this is a compilation of
          records, not a certificate of compliance. */}
      <footer className="pt-6 text-xs text-ink-subtle">
        <p>
          This pack was compiled automatically from the records held in{' '}
          {branding.companyName} for this project on{' '}
          {formatDateUK(pack.generatedAt)}. It is a record of what was captured,
          not an assessment or certification of compliance. The Principal
          Contractor remains responsible for the accuracy and completeness of
          project records under CDM 2015.
        </p>
        {narrative ? (
          <p className="mt-2">
            Passages marked &ldquo;AI-generated&rdquo; in this pack were written
            automatically as descriptive summaries of the records above. They
            are not assessments, certifications or approvals of compliance.
          </p>
        ) : null}
      </footer>
    </article>
  );
}
