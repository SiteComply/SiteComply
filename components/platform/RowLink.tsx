import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A full-width, clearly-clickable drill-down row used across the Site/Worker
 * detail lists (workers, submissions, audits, actions, current site). Gives every
 * related entity a consistent affordance: whole-row hover highlight, a brand-
 * coloured title, a keyboard focus ring and a chevron that nudges on hover — so
 * users can spot a drill-down at a glance. Navigation targets stay RBAC/site-
 * scoped: these only ever link to records the page already resolved in scope.
 */
export function RowLink({
  href,
  trailing,
  children,
}: {
  href: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group -mx-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-brand-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        {trailing}
        <DrillChevron />
      </div>
    </Link>
  );
}

/** Standalone chevron affordance for contexts where a full RowLink can't be used
 *  (e.g. a table row). Animate on the row's `group` hover. */
export function DrillChevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 text-brand-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 4l6 6-6 6" />
    </svg>
  );
}
