import { cn } from '@/lib/cn';
import { WorkerIcon } from './icons';

/**
 * The visible chrome for the worker header's site control — shared so the two
 * states cannot drift apart again.
 *
 * Both a worker on one site and a worker on several see the SAME object: same
 * border, radius, padding, 52px height, icon placement, two-line hierarchy and
 * alignment. Only three things vary, and each is a deliberate signal that this
 * one is read-only:
 *
 *   fill        surface (raised, actionable) vs surface-sunken (recessed)
 *   chevron     present vs absent
 *   supporting  "Switch site" vs "Current site"
 *
 * The recessed fill is not decoration. It is the signal this codebase already
 * uses for "you can look but not change this" — see components/admin/
 * ReadOnlyBanner, and the Compliance Calendar's treatment of cells that cannot
 * be acted on. It distinguishes the two states before a word is read, which is
 * how anyone actually scans a header.
 *
 * WHY THIS MATTERS MORE THAN CONSISTENCY. A bordered box that looks like a
 * control and does nothing is worse than plain text: it teaches the worker that
 * the header does not respond, on the same row as Check out, which they have to
 * trust. So the read-only variant is separated on four signals — no chevron,
 * different words, recessed fill, and no interactive behaviour whatsoever. The
 * caller renders no <select> for it at all, so there is nothing focusable and
 * assistive technology announces text rather than a control.
 */
export function SiteControlChrome({
  siteName,
  supportingText,
  interactive,
  dimmed = false,
}: {
  siteName: string;
  supportingText: string;
  /** True only for the real switcher. Adds the chevron, the raised fill and
   *  the hover/focus states driven by the `peer` select above it. */
  interactive: boolean;
  /** Busy state on the switcher; never set for the read-only variant. */
  dimmed?: boolean;
}) {
  return (
    <span
      // Decorative for the switcher, where the <select> beneath carries the
      // accessible name. For the read-only variant there is no select, so this
      // IS the content and must stay in the accessibility tree.
      aria-hidden={interactive ? true : undefined}
      className={cn(
        'touch-target flex w-full min-w-0 items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-left transition-colors',
        interactive ? 'bg-surface' : 'bg-surface-sunken',
        // Driven by the `peer` <select> the switcher lays over this. The
        // read-only variant has no select, so these never apply to it — it has
        // no hover and no focus state by construction, not by omission.
        interactive &&
          'peer-hover:border-brand-200 peer-hover:bg-brand-50 peer-focus-visible:outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface',
        dimmed && 'opacity-60',
      )}
    >
      <WorkerIcon name="building" className="h-5 w-5 shrink-0 text-ink-subtle" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {siteName}
        </span>
        <span className="block truncate text-xs text-ink-subtle">
          {supportingText}
        </span>
      </span>
      {interactive && (
        <WorkerIcon
          name="chevronDown"
          className="h-4 w-4 shrink-0 text-ink-subtle"
        />
      )}
    </span>
  );
}
