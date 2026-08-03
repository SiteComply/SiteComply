import Link from 'next/link';
import type { ReactNode } from 'react';
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
    <div className="mb-6 border-b border-line pb-4">
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
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
