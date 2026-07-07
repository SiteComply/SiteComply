import Link from 'next/link';
import type { ResolvedPage } from '@/lib/pagination';

/**
 * The shared result-count + page navigation bar shown at the foot of every
 * platform list view. Renders "Showing X–Y of N" plus Previous / Next links that
 * preserve the current search and filters (only the `page` param changes). Used
 * consistently across Documents, Audits and Actions so the experience matches.
 */
export function PaginationControls({
  basePath,
  params,
  pg,
}: {
  basePath: string;
  /** Current query params to preserve (search + filters), excluding `page`. */
  params: Record<string, string | undefined>;
  pg: ResolvedPage;
}) {
  const { page, pageCount, pageSize, total } = pg;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
      <span className="text-ink-subtle">
        {total === 0 ? (
          'No results'
        ) : (
          <>
            Showing <span className="font-semibold text-ink">{start}–{end}</span> of{' '}
            <span className="font-semibold text-ink">{total}</span>
          </>
        )}
      </span>
      <div className="flex items-center gap-2">
        <PageLink href={href(page - 1)} disabled={page <= 1}>
          Previous
        </PageLink>
        <span className="tabular-nums text-ink-subtle">
          Page {page} of {pageCount}
        </span>
        <PageLink href={href(page + 1)} disabled={page >= pageCount}>
          Next
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const cls =
    'rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors';
  if (disabled) {
    return (
      <span className={`${cls} cursor-default border-line text-ink-subtle opacity-50`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${cls} border-brand-500 text-brand-700 hover:bg-brand-50`}
    >
      {children}
    </Link>
  );
}
