import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import {
  navGroupRuns,
  NAV_GROUP_LABEL_CLASS,
  NAV_GROUP_SPLIT_LG,
} from '@/components/platform/navUi';

export interface WorkspaceSection {
  key: string;
  label: string;
  /** One short line shown under the section heading. */
  description?: string;
  /**
   * UX REFRESH PHASE 9 — the run this section belongs to, e.g. "Induction &
   * check-in". Presentation only, and set by the caller: this component never
   * decides which sections exist, so it never decides what a group contains
   * either.
   *
   * Sections sharing a group MUST be adjacent in the array. Runs are collapsed
   * from consecutive equal values (see `navGroupRuns`) precisely so that grouping
   * cannot reorder a navigator behind the caller's back — a group split in two
   * shows up as two headings rather than being silently rearranged.
   */
  group?: string;
}

/**
 * A workspace: a persistent section navigator beside one section's content.
 *
 * The problem this solves, measured on Site → Worker Experience before it was
 * applied: eight panels in a two-column grid, 3,484px tall — about three and a
 * half screens. Because grid items stretch to their row's height, a short panel
 * next to a tall one produced several hundred pixels of dead white space, over
 * and over down the page. The reader had to scroll past seven settings areas
 * they were not interested in to reach the eighth.
 *
 * Showing one section at a time removes both problems at once: no mismatched
 * neighbours, so no voids, and the page is as long as the section rather than as
 * long as all of them. The navigator keeps every section one click away and
 * visible, so nothing is hidden — which is the difference between a workspace
 * and an accordion.
 *
 * Selection lives in the URL (`?section=`), matching how the Site Details tabs
 * already work, so a section is linkable, survives a refresh and needs no client
 * state. Callers decide which sections exist — this component never evaluates a
 * permission.
 */
export function SectionWorkspace({
  sections,
  active,
  hrefFor,
  navLabel,
  actions,
  children,
}: {
  /** Only the sections this viewer may see. Order is preserved. */
  sections: WorkspaceSection[];
  active: string;
  hrefFor: (key: string) => string;
  navLabel: string;
  /** Controls for the active section, right-aligned on its heading row. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const current = sections.find((s) => s.key === active) ?? sections[0];
  const runs = navGroupRuns(sections, (s) => s.group);

  return (
    // UX REFRESH PHASE 9 — the navigator and the section it controls used to sit
    // 16px apart with nothing between them, so the list of sections read as the
    // first column of the content rather than as the thing that selects it. A
    // hairline down the column edge and a wider gutter separate the two, which is
    // what lets the eye treat the right-hand side as one surface.
    <div className="grid gap-4 lg:grid-cols-[13.5rem_1fr] lg:gap-6">
      <nav
        aria-label={navLabel}
        className="flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col lg:gap-0 lg:self-start lg:overflow-visible lg:border-r lg:border-line lg:pr-4"
      >
        {runs.map((run, ri) => (
          <div
            key={run.group ?? ri}
            role="group"
            aria-label={run.group}
            className={cn(
              'flex gap-1 lg:flex-col',
              ri > 0 && NAV_GROUP_SPLIT_LG,
            )}
          >
            {run.group && (
              <p
                aria-hidden="true"
                className={cn(NAV_GROUP_LABEL_CLASS, 'hidden lg:block')}
              >
                {run.group}
              </p>
            )}
            {run.items.map((s) => {
              const isActive = s.key === current?.key;
              return (
                <Link
                  key={s.key}
                  href={hrefFor(s.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'touch-target flex items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:whitespace-normal',
                    isActive
                      ? 'bg-brand-50 font-semibold text-brand-700'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  )}
                >
                  {s.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="min-w-0">
        {current && (
          <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-ink">{current.label}</h2>
              {current.description && (
                <p className="mt-0.5 text-sm text-ink-muted">
                  {current.description}
                </p>
              )}
            </div>
            {actions && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {actions}
              </div>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Resolve the section to show from a URL parameter.
 *
 * Falls back to the first AVAILABLE section rather than erroring, and never
 * distinguishes "no such section" from "not available to you" — a 404 on an
 * unavailable key would confirm the key exists.
 */
export function resolveSection(
  raw: string | string[] | undefined,
  sections: WorkspaceSection[],
): string {
  const want = Array.isArray(raw) ? raw[0] : raw;
  const match = sections.find((s) => s.key === want);
  return match?.key ?? sections[0]?.key ?? '';
}
