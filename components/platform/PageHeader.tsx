import type { ReactNode } from 'react';

/**
 * The one way a Platform screen opens.
 *
 * Before the UX Refresh every register and hub hand-rolled the same block —
 * `<h1>` plus a muted description, with a scope chip and actions floated right —
 * and each one drifted slightly: different gaps, different wrapping behaviour,
 * actions sometimes above the description and sometimes beside it. Individually
 * invisible; collectively it is a large part of why the portal reads as separate
 * widgets rather than one application.
 *
 * Presentation only. Callers pass the same nodes they already rendered, so every
 * permission gate, link, count and aria attribute stays exactly where it was —
 * this component decides layout, never what is allowed to appear.
 *
 * The rule below the header is deliberate: it separates page chrome from page
 * content, which is what lets the content area drop its own decorative framing
 * without everything running together.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  breadcrumbs,
}: {
  title: string;
  /** One line of context. Keep it short — the brief asks for less prose, not more. */
  description?: ReactNode;
  /** Small status/scope adornments shown beside the title (e.g. the scope chip). */
  meta?: ReactNode;
  /** Primary/secondary actions, right-aligned on wide screens. */
  actions?: ReactNode;
  /** Optional breadcrumb trail rendered above the title. */
  breadcrumbs?: ReactNode;
}) {
  return (
    <header className="mb-6 border-b border-line pb-5">
      {breadcrumbs}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              {title}
            </h1>
            {meta}
          </div>
          {description && (
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
          )}
        </div>
        {/* UX REFRESH PHASE 8 (mobile pass) — `shrink-0` held this row at its
            content width, so a site header with five buttons forced the whole
            PAGE 184px wider than a 390px phone and every site tab scrolled
            sideways. It only needs to resist shrinking once there is room to sit
            beside the title, so the rule now starts at `sm`. Pre-existing: the
            same construct was in SiteDetailHeader at rev1-complete. */}
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
