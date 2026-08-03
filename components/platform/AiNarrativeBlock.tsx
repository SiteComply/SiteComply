/**
 * SC-024 Phase 3 — how AI-written prose is marked in a close-out pack.
 *
 * Every piece of generated text carries a visible label, in print as well as on
 * screen. A close-out pack is handed to clients and read months later by people
 * who were never told which paragraphs a model wrote — a badge that disappears
 * when the page is printed would be worse than no badge, because the printed
 * copy is the one that gets filed.
 *
 * The border and tint are deliberately retained in print (`print:` utilities are
 * NOT used to strip them) for the same reason.
 */

export function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-brand-700/40 bg-brand-700/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-3 w-3"
        fill="currentColor"
      >
        <path d="M12 2l1.9 5.3L19 9l-5.1 1.7L12 16l-1.9-5.3L5 9l5.1-1.7L12 2zm6 12l.9 2.6L21 17l-2.1.8L18 20l-.9-2.2L15 17l2.1-.4L18 14z" />
      </svg>
      AI-generated
    </span>
  );
}

/** A labelled block of AI prose. */
export function AiNarrativeBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-brand-700/30 bg-brand-700/5 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold text-ink">{title}</h3>
        <AiBadge />
      </div>
      <div className="text-sm leading-relaxed text-ink">{children}</div>
    </section>
  );
}

/**
 * The standing note that accompanies AI prose wherever it appears.
 *
 * States what the text is, what it is not, and that responsibility is unchanged.
 */
export function AiNarrativeNote({
  model,
  generatedAt,
  generatedBy,
}: {
  model?: string | null;
  generatedAt?: Date | null;
  generatedBy?: string | null;
}) {
  const provenance = [
    generatedAt ? `Generated ${generatedAt.toLocaleDateString('en-GB')}` : null,
    generatedBy ? `by ${generatedBy}` : null,
    model ? `using ${model}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
      This narrative was written automatically from the records held in this
      project and is provided as a descriptive summary only. It is not an
      assessment, certification or approval of compliance, and it does not
      constitute a professional opinion. The project team remains responsible
      for the accuracy and completeness of this pack and for all compliance
      decisions.
      {provenance ? ` ${provenance}.` : ''}
    </p>
  );
}
