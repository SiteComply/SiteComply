import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';

/**
 * The one way a single record opens — an action, an audit, a permit, a worker,
 * a site.
 *
 * Every detail page had independently arrived at the same four ideas
 * (breadcrumb, back link, title with status badges, right-aligned actions) and
 * spelled them slightly differently: `gap-2` here and `gap-3` there,
 * `items-start` on one and `items-center` on the next, the subtitle sometimes
 * inside the title block and sometimes after it. Individually trivial; together
 * it is why moving between two records feels like moving between two products.
 *
 * Presentation only. Badges and actions are passed in by the caller, so which
 * of them appear is still decided by the caller's permission checks — this
 * component never evaluates one.
 *
 * `children` renders below the header rule, which is where a tab bar goes.
 */
export function RecordHeader({
  breadcrumbs,
  backHref,
  backLabel,
  title,
  badges,
  subtitle,
  actions,
  children,
}: {
  /** `{label, href?}` pairs — the final crumb is the record itself. */
  breadcrumbs?: { label: string; href?: string }[];
  backHref?: string;
  backLabel?: string;
  title: ReactNode;
  /** Status pills shown beside the title. */
  badges?: ReactNode;
  /** One line of context — the site a record belongs to, a reference, a date. */
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    // UX REFRESH PHASE 9 — a header with a tab bar was drawing TWO horizontal
    // rules 16px apart: the tab strip's own underline, then this block's. Two
    // parallel lines that close together read as a mistake and squeeze the tabs
    // between them. When there is a tab bar it IS the boundary, so the header
    // drops its rule and lets the tabs close the block.
    <div className={cn('mb-6', children ? '' : 'border-b border-line pb-4')}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      {backHref && (
        <Link
          href={backHref}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← {backLabel ?? 'Back'}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              {title}
            </h1>
            {badges}
          </div>
          {subtitle && <p className="text-ink-muted">{subtitle}</p>}
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
      {children}
    </div>
  );
}
