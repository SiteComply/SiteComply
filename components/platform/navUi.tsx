import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * The shared vocabulary for grouping a navigator.
 *
 * UX REFRESH PHASE 9. Phase 1 clustered the eleven rail entries and expressed
 * the clusters as SPACING ALONE — 12px between runs against 4px between items —
 * on the reasoning that group headings would add explanatory chrome. Measured on
 * the built page that difference is invisible: the rail reads as one uniform
 * list of eleven, and the same was true of every navigator built after it (eight
 * Worker Experience sections, seventeen setup steps). A grouping nobody can see
 * is not a grouping.
 *
 * So a run of items now gets a hairline rule, a real gap and a quiet label. All
 * three, deliberately: the rule says "these are separate", the gap gives the eye
 * somewhere to rest, and the label says WHAT they are — which spacing alone can
 * never do.
 *
 * NOTHING HERE IS A PERMISSION. Callers pass items they have already filtered;
 * a group is a presentational run and a label describes only the items actually
 * visible to this viewer. An empty group renders nothing at all, so a heading can
 * never hint that something was filtered out.
 */

/** One run of consecutive items sharing a group. */
export interface NavRun<T> {
  group: string | undefined;
  items: T[];
}

/**
 * Collapse items into runs of consecutive equal groups.
 *
 * CONSECUTIVE, not collected: the order the caller passes is the order rendered,
 * so grouping can never silently reorder a navigator. A group that appears twice
 * non-contiguously therefore yields two runs and two labels — visibly wrong,
 * which is the point. That exact mistake was made in Phase 1 and is asserted
 * against in the deploy guard.
 *
 * An item with no group joins the run before it rather than starting an unlabelled
 * one, so a new entry added upstream without a group lands somewhere sensible
 * instead of splitting the list.
 */
export function navGroupRuns<T>(
  items: T[],
  groupOf: (item: T) => string | undefined,
): NavRun<T>[] {
  const runs: NavRun<T>[] = [];
  for (const item of items) {
    const previous = runs[runs.length - 1];
    const group = groupOf(item) ?? previous?.group;
    if (previous && previous.group === group) previous.items.push(item);
    else runs.push({ group, items: [item] });
  }
  return runs;
}

/**
 * The group label. Small, muted and uppercase so it reads as a signpost rather
 * than as another item — a heading the same weight as its contents adds noise
 * instead of structure.
 */
export const NAV_GROUP_LABEL_CLASS =
  'px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle';

/**
 * Separation between runs, for a navigator that is vertical from `md` up and a
 * horizontal scroller below it (the application rail).
 *
 * The rule turns with the navigator: a vertical stack is divided horizontally, a
 * horizontal scroller vertically. Written out per breakpoint because Tailwind
 * cannot build a class name at runtime.
 */
export const NAV_GROUP_SPLIT_MD =
  'ml-1 border-l border-line pl-2 md:ml-0 md:mt-4 md:border-l-0 md:border-t md:pl-0 md:pt-4';

/** The same, for a workspace navigator that is vertical from `lg` up. */
export const NAV_GROUP_SPLIT_LG =
  'ml-1 border-l border-line pl-2 lg:ml-0 lg:mt-4 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-4';

/**
 * A register's status filter strip — Sites and Check-ins had arrived at the same
 * markup independently, and both rendered it as a CARD (`bg-surface` + `border` +
 * `shadow-card`) sitting immediately above the table's card. Two stacked panels
 * for one list is precisely the widget stacking the refresh set out to remove,
 * and it left the filter competing with the data instead of controlling it.
 *
 * It is now recessed, in the same language as the report control strip and the
 * table toolbar: sunken, unshadowed, clearly a control. One definition, so the
 * two registers cannot drift apart again.
 *
 * Presentation only — every href, label and count is passed in by the caller and
 * the filters themselves are unchanged.
 */
export function SegmentedNav({
  label,
  items,
  className,
  size = 'sm',
}: {
  /** Accessible name for the strip, e.g. "Filter sites by status". */
  label: string;
  items: {
    key: string;
    label: string;
    href: string;
    active: boolean;
    /** Optional count pill. */
    count?: ReactNode;
  }[];
  className?: string;
  /**
   * `sm` — the default, and what every existing strip renders. Unchanged.
   * `md` — one step up, for a strip that is the PRIMARY navigation of a
   *        workspace rather than a filter above a list, and therefore needs a
   *        larger target and more presence. Opt-in precisely so adding it
   *        cannot move the four existing call sites.
   */
  size?: 'sm' | 'md';
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-sunken p-1',
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors',
            size === 'md'
              ? 'touch-target px-5 py-2.5 text-sm'
              : 'px-3 py-1.5 text-sm',
            item.active
              ? 'bg-brand-500 text-white shadow-sm'
              : 'text-ink-muted hover:bg-surface hover:text-ink',
          )}
        >
          {item.label}
          {item.count !== undefined && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                item.active
                  ? 'bg-white/25 text-white'
                  : 'bg-surface text-ink-subtle',
              )}
            >
              {item.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
