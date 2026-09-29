import Link from 'next/link';
import type { Attention, AttentionTarget } from '@/services/inductionVideo/attentionService';

/**
 * A COMPACT ATTENTION SUMMARY: counts on one line, detail on demand.
 *
 * ── WHY IT IS COUNTS AND NOT SENTENCES ────────────────────────────────────
 *
 * The first version printed a row per item — a title, an explanation and a button,
 * four of them — which repeated what the list underneath already said and took up as
 * much room as the content it was introducing. Counts collapse five drafts into "5
 * modules in draft": the strip tells you the SHAPE of the work, and the list tells you
 * which rows. Expand it when you want the specifics.
 *
 * ── STILL NO JAVASCRIPT ───────────────────────────────────────────────────
 *
 * The expansion is a native <details>/<summary>, so this stays a Server Component
 * with no state and nothing shipped to the browser. A useState toggle would have
 * turned a summary line into a client bundle, and the browser already does disclosure
 * properly — including for a keyboard and a screen reader.
 *
 * ── IT DISAPPEARS WHEN THERE IS NOTHING TO SAY ────────────────────────────
 *
 * No "all clear" panel. A strip that is always there stops being read, and the whole
 * value of this one is that its presence means something.
 *
 * ── THE HREFS ARE BUILT HERE ──────────────────────────────────────────────
 *
 * The service returns what each item POINTS AT — a kind and an id — and this joins it
 * to the base paths its tier passes in. Returning built URLs would make the service
 * tier-aware; passing a builder in would be a function prop across the boundary,
 * which is what took the Library index down in production.
 */

export function AttentionSummary({
  attention,
  modulesBasePath,
  libraryBasePath,
  videoBasePath,
}: {
  attention: Attention;
  /** e.g. /platform/dashboard/induction-videos/modules */
  modulesBasePath: string;
  /** e.g. /platform/dashboard/induction-videos/library */
  libraryBasePath: string;
  /** e.g. /platform/dashboard/induction-videos — one version of a video lives under it */
  videoBasePath: string;
}) {
  if (attention.items.length === 0) return null;

  const href = (t: AttentionTarget): string => {
    switch (t.kind) {
      case 'module':
        return `${modulesBasePath}/${t.id}`;
      case 'asset':
        return `${libraryBasePath}/${t.id}`;
      case 'video':
        return `${videoBasePath}/${t.id}`;
      case 'modules':
        return modulesBasePath;
      case 'library':
        return libraryBasePath;
    }
  };

  const headline =
    attention.actionCount > 0
      ? `${attention.actionCount} need${attention.actionCount === 1 ? 's' : ''} action`
      : 'Worth knowing';

  return (
    <details className="group mb-3 rounded-xl border border-line bg-surface shadow-card">
      {/*
        * ONE LINE, CLOSED. The count chips are the summary; the caret is the only
        * control. `list-none` removes the browser's default marker so the layout is
        * ours, and the caret rotates with `group-open` — no script involved.
        */}
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            attention.actionCount > 0
              ? 'bg-hivis-400/20 text-ink'
              : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          {headline}
        </span>

        {attention.counts.map((c) => (
          <span
            key={c.category}
            className={`text-xs ${
              c.severity === 'action' ? 'font-semibold text-ink' : 'text-ink-muted'
            }`}
          >
            {c.label}
          </span>
        ))}

        <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-brand-700">
          <span className="group-open:hidden">Show detail</span>
          <span className="hidden group-open:inline">Hide detail</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-3 w-3 transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
      </summary>

      {/*
        * EXPANDED: every item, not a capped subset. The cap existed because these rows
        * were always on screen; behind a disclosure they cost nothing until asked for,
        * and a truncated expansion would be a worse answer than a long one.
        */}
      <ul className="divide-y divide-line border-t border-line">
        {attention.items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                item.severity === 'action' ? 'bg-hivis-600' : 'bg-ink-subtle'
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{item.title}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{item.detail}</p>
            </div>
            <Link
              href={href(item.target)}
              className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              {item.action}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
