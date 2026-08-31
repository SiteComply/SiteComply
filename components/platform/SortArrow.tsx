import { cn } from '@/lib/cn';

/**
 * The sort indicator on a sortable column heading.
 *
 * Only the ACTIVE column shows a solid arrow; the others reveal a faint one on
 * hover or keyboard focus. That says "this is sortable" without putting an arrow
 * on every heading, where four of them compete and none means anything.
 *
 * Decorative: the heading itself carries `aria-sort`, so this is aria-hidden.
 *
 * Shared by the Check-ins and Actions registers. It lives here rather than in
 * either page because it is the same indicator, and two copies would drift.
 */
export function SortArrow({
  active,
  dir,
}: {
  active: boolean;
  dir: 'asc' | 'desc';
}) {
  const up = active ? dir === 'asc' : true;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        'h-3 w-3 shrink-0 transition-opacity',
        active
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-40 group-focus-visible:opacity-40',
      )}
    >
      {up ? (
        <>
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </>
      ) : (
        <>
          <path d="M12 5v14" />
          <path d="M19 12l-7 7-7-7" />
        </>
      )}
    </svg>
  );
}
