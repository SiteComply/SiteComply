/**
 * Site status filtering for the Sites list — pure, client-safe helpers (no
 * Prisma/server imports) so the page and any test share one source of truth.
 *
 * The filter only ever NARROWS an already-scoped list of sites; it never adds
 * sites, so RBAC and site-scoping (applied upstream when the viewer's sites are
 * resolved) are preserved by construction. Because the Sites page is dynamic and
 * re-derives the viewer's sites per request, newly archived or reactivated sites
 * are filtered live.
 */

export type SiteStatusFilter = 'all' | 'active' | 'archived';

export const SITE_STATUS_FILTERS: { value: SiteStatusFilter; label: string }[] =
  [
    { value: 'all', label: 'All sites' },
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archived' },
  ];

/** Parse a raw `?status` value into a valid filter; unknown/empty → 'all'. */
export function parseSiteStatusFilter(raw?: string): SiteStatusFilter {
  const v = (raw ?? '').toLowerCase();
  return v === 'active' || v === 'archived' ? v : 'all';
}

/** Narrow an already-scoped site list by status (never widens the set). */
export function filterSitesByStatus<
  T extends { status: 'ACTIVE' | 'ARCHIVED' },
>(sites: T[], filter: SiteStatusFilter): T[] {
  if (filter === 'all') return sites;
  const target = filter === 'active' ? 'ACTIVE' : 'ARCHIVED';
  return sites.filter((s) => s.status === target);
}

/** Per-bucket counts from an already-scoped list, for the filter labels. */
export function siteStatusCounts(sites: { status: 'ACTIVE' | 'ARCHIVED' }[]): {
  all: number;
  active: number;
  archived: number;
} {
  let active = 0;
  let archived = 0;
  for (const s of sites) {
    if (s.status === 'ACTIVE') active++;
    else archived++;
  }
  return { all: sites.length, active, archived };
}
