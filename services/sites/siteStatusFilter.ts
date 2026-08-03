/**
 * Site status filtering for the Sites list — pure, client-safe helpers (no
 * Prisma/server imports) so the page and any test share one source of truth.
 *
 * The filter only ever NARROWS an already-scoped list of sites; it never adds
 * sites, so RBAC and site-scoping (applied upstream when the viewer's sites are
 * resolved) are preserved by construction. Because the Sites page is dynamic and
 * re-derives the viewer's sites per request, newly archived, completed or
 * reactivated sites are filtered live.
 *
 * SC-025 added COMPLETED as a third status. Note what that broke here: the old
 * `siteStatusCounts` counted anything that was not ACTIVE as archived, so a
 * completed project would have been silently tallied as archived; and the old
 * filter mapped 'archived' to ARCHIVED only, so completed projects would have
 * disappeared from every filter except "All". Both are now explicit per value.
 */

/** Every stored site status. Mirrors the Prisma `SiteStatus` enum exactly. */
export type SiteStatusValue = 'ACTIVE' | 'ARCHIVED' | 'COMPLETED';

export type SiteStatusFilter = 'all' | 'active' | 'archived' | 'completed';

export const SITE_STATUS_FILTERS: { value: SiteStatusFilter; label: string }[] =
  [
    { value: 'all', label: 'All projects' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
    { value: 'archived', label: 'Archived' },
  ];

export const SITE_STATUS_LABEL: Record<SiteStatusValue, string> = {
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
  COMPLETED: 'Completed',
};

/** Parse a raw `?status` value into a valid filter; unknown/empty → 'all'. */
export function parseSiteStatusFilter(raw?: string): SiteStatusFilter {
  const v = (raw ?? '').toLowerCase();
  return v === 'active' || v === 'archived' || v === 'completed' ? v : 'all';
}

const FILTER_TO_STATUS: Record<
  Exclude<SiteStatusFilter, 'all'>,
  SiteStatusValue
> = {
  active: 'ACTIVE',
  archived: 'ARCHIVED',
  completed: 'COMPLETED',
};

/** Narrow an already-scoped site list by status (never widens the set). */
export function filterSitesByStatus<T extends { status: SiteStatusValue }>(
  sites: T[],
  filter: SiteStatusFilter,
): T[] {
  if (filter === 'all') return sites;
  const target = FILTER_TO_STATUS[filter];
  return sites.filter((s) => s.status === target);
}

/** Per-bucket counts from an already-scoped list, for the filter labels. */
export function siteStatusCounts(sites: { status: SiteStatusValue }[]): {
  all: number;
  active: number;
  archived: number;
  completed: number;
} {
  let active = 0;
  let archived = 0;
  let completed = 0;
  for (const s of sites) {
    // Counted explicitly per value — an "everything else" branch is exactly how
    // a newly added status gets silently mislabelled.
    if (s.status === 'ACTIVE') active++;
    else if (s.status === 'COMPLETED') completed++;
    else archived++;
  }
  return { all: sites.length, active, archived, completed };
}

/**
 * Is this project closed to new work?
 *
 * THE single definition. Read-only enforcement, dashboard exclusion and every
 * "can this still be edited?" question resolve through here, so changing what
 * counts as closed is one edit rather than a search across the codebase.
 *
 * ARCHIVED is deliberately NOT closed: it is the pre-SC-025 soft hide, and the
 * sites carrying it never passed a completion checklist.
 */
export function isProjectClosed(status: SiteStatusValue): boolean {
  return status === 'COMPLETED';
}
