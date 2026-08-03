import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface WorkspaceSection {
  key: string;
  label: string;
  /** One short line shown under the section heading. */
  description?: string;
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

  return (
    <div className="grid gap-4 lg:grid-cols-[13.5rem_1fr]">
      <nav
        aria-label={navLabel}
        className="flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col lg:self-start lg:overflow-visible"
      >
        {sections.map((s) => {
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
      </nav>

      <div className="min-w-0">
        {current && (
          <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
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
