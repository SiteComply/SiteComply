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

import { checkinSortParams, type CheckinSort } from './checkinSort';

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

/**
 * Parse a raw `?site` value into a site id the viewer may actually see.
 *
 * Validated against the viewer's own site list, so an id for a site outside
 * their scope resolves to null (= All Sites) rather than being passed to the
 * query. The list query is site-scoped anyway, so this is defence in depth: it
 * keeps an out-of-scope id from being reflected back in links and counts.
 * Mirrors how the Compliance Calendar validates its `?site` param.
 */
export function parseCheckinSiteFilter(
  raw: string | undefined,
  allowedSiteIds: string[],
): string | null {
  const v = (raw ?? '').trim();
  return v && allowedSiteIds.includes(v) ? v : null;
}

/**
 * Build the check-ins list href for a given status + site combination, so the
 * two filters compose: changing the status keeps the chosen site, and vice
 * versa. Omitting a param entirely (rather than passing an empty value) keeps
 * the default URL clean and bookmarkable.
 */
export function checkinFilterHref(
  basePath: string,
  status: CheckinStatusFilter,
  siteId: string | null,
  sort?: CheckinSort,
): string {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (siteId) params.set('site', siteId);
  // Sort travels with the filters, so changing status or site keeps the column
  // you are sorting by — and the sort links keep the filters. Omitted when it
  // is the default, so the plain URL stays clean.
  const sp = sort ? checkinSortParams(sort) : {};
  if (sp.sort) params.set('sort', sp.sort);
  if (sp.dir) params.set('dir', sp.dir);
  // `page` is deliberately absent: both a filter change and a sort change
  // reorder or resize the set, so page 4 of the old set means nothing in the
  // new one.
  const q = params.toString();
  return q ? `${basePath}?${q}` : basePath;
}
