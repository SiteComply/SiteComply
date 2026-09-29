import Link from 'next/link';
import type { Attention, AttentionTarget } from '@/services/inductionVideo/attentionService';

/**
 * A SMALL STATUS AREA: what needs somebody, above the list.
 *
 * ── WHAT IT IS AND WHAT IT IS NOT ─────────────────────────────────────────
 *
 * It is a summary, not a dashboard. The owner chose Option A's master–detail lists
 * with "a lightweight attention summary rather than the full D layout", so this sits
 * in a few lines above the list and never pushes it off the screen: the most urgent
 * items, then a count of the rest.
 *
 * ── IT DISAPPEARS WHEN THERE IS NOTHING TO SAY ────────────────────────────
 *
 * No "all clear" panel, no green tick taking up the top of the page every day. A
 * strip that is always there stops being read, and the whole value of this is that
 * its presence means something.
 *
 * ── A SERVER COMPONENT, AND THE HREFS ARE BUILT HERE ──────────────────────
 *
 * No state and no handlers, so nothing ships to the browser. The service returns what
 * each item POINTS AT - a kind and an id - and this joins it to the base paths its
 * tier passes in. Returning built URLs would make the service tier-aware; passing a
 * builder in would be a function prop across the boundary, which is what took the
 * Library index down in production.
 */

const MAX_SHOWN = 4;

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

  const shown = attention.items.slice(0, MAX_SHOWN);
  const hidden = attention.items.length - shown.length;

  return (
    <section
      aria-labelledby="attention-heading"
      className="mb-3 rounded-xl border border-line bg-surface p-4 shadow-card"
    >
      <h2 id="attention-heading" className="text-sm font-bold text-ink">
        {attention.actionCount > 0
          ? `${attention.actionCount} ${attention.actionCount === 1 ? 'thing needs' : 'things need'} you`
          : 'Worth knowing'}
      </h2>

      <ul className="mt-2 space-y-2">
        {shown.map((item) => (
          <li
            key={item.key}
            className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${
              item.severity === 'action'
                ? 'border-hivis-500/40 bg-hivis-400/10'
                : 'border-line bg-surface-sunken'
            }`}
          >
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

      {hidden > 0 && (
        <p className="mt-2 text-xs text-ink-subtle">
          {/*
            * CAPPED, and honest about it. An uncapped strip on a company with thirty
            * assets would be the whole page, which is the thing Option D was rejected
            * for.
            */}
          and {hidden} more — {hidden === 1 ? 'it is' : 'they are'} in the lists below,
          marked on their rows.
        </p>
      )}
    </section>
  );
}
