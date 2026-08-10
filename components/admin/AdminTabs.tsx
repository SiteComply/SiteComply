import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Horizontal tab strip for an Admin Centre workspace.
 *
 * Deliberately a SERVER component. The Platform portal's SiteDetailTabs is a
 * client component only because it falls back to `usePathname()` when the
 * caller cannot say which tab is active; here the page reads the tab from its
 * own searchParams, so it always knows. Adding a client boundary to render six
 * links would be cost for nothing.
 *
 * TABS ARE ADDRESSES, NOT LOCAL STATE. Each carries a query parameter rather
 * than toggling something in the browser, so a tab can be linked to, bookmarked
 * and reloaded — and a redirect after saving can return the admin to the tab
 * they were on. Local state would lose all three.
 *
 * Markup matches SiteDetailTabs so the two portals do not drift into two
 * different-looking tab strips.
 */
export interface AdminTab {
  key: string;
  label: string;
  /** Short line describing what the tab holds, shown under the heading. */
  hint?: string;
}

export function AdminTabs({
  tabs,
  active,
  basePath,
  param = 'tab',
  label,
}: {
  tabs: AdminTab[];
  active: string;
  basePath: string;
  param?: string;
  /** Accessible name for the navigation landmark. */
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="mt-5 flex gap-1 overflow-x-auto border-b border-line"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`${basePath}?${param}=${tab.key}`}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors',
              isActive
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-ink-muted hover:border-line hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
