import Link from 'next/link';
import { Fragment } from 'react';

export interface Crumb {
  label: string;
  /** Parent view link. Omit (or on the last/current crumb) to render as plain text. */
  href?: string;
}

/**
 * Platform breadcrumb trail (e.g. "Sites › Test Site A", "Check-ins › Tom
 * Smith"). Parent crumbs link back to their list view; the final crumb is the
 * current page. Uses the Platform link language (brand links, muted chevron
 * separators) and wraps responsively on narrower tablet widths. Parent links only
 * ever point at list views the viewer already reached under RBAC/site-scoping, so
 * it grants no new access.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={i}>
              <li className="flex min-w-0 items-center">
                {c.href && !last ? (
                  <Link
                    href={c.href}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={
                      last
                        ? 'max-w-[70vw] truncate font-semibold text-ink sm:max-w-xs'
                        : 'text-ink-muted'
                    }
                  >
                    {c.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="flex items-center text-ink-subtle">
                  <svg
                    viewBox="0 0 20 20"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 5l5 5-5 5" />
                  </svg>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
