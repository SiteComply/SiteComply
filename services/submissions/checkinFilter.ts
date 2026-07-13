/**
 * Check-in status filtering for the Check-ins list — pure, client-safe helpers
 * (no Prisma/server imports) so the page and any test share one source of truth.
 * Mirrors the Sites status filter (services/sites/siteStatusFilter.ts).
 *
 * A check-in's status is derived from `checkedOutAt`: still on site when it is
 * null, checked out when it is set. The filter is applied inside the viewer's
 * already site-scoped query, so RBAC and site-scoping are preserved and counts
 * reflect only the records the current user may see.
 */

export type CheckinStatusFilter = 'all' | 'on-site' | 'checked-out';

export const CHECKIN_STATUS_FILTERS: {
  value: CheckinStatusFilter;
  label: string;
}[] = [
  { value: 'all', label: 'All check-ins' },
  { value: 'on-site', label: 'On site' },
  { value: 'checked-out', label: 'Checked out' },
];

/** Parse a raw `?status` value into a valid filter; unknown/empty → 'all'. */
export function parseCheckinStatusFilter(raw?: string): CheckinStatusFilter {
  const v = (raw ?? '').toLowerCase();
  return v === 'on-site' || v === 'checked-out' ? v : 'all';
}

/**
 * The `checkedOutAt` predicate for a filter, merged into an existing (already
 * site-scoped) Prisma `where`. 'all' adds nothing; 'on-site' → still checked in;
 * 'checked-out' → has a check-out time.
 */
export function checkedOutAtWhere(
  filter: CheckinStatusFilter,
):
  | { checkedOutAt: null }
  | { checkedOutAt: { not: null } }
  | Record<string, never> {
  if (filter === 'on-site') return { checkedOutAt: null };
  if (filter === 'checked-out') return { checkedOutAt: { not: null } };
  return {};
}
