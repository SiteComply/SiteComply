import { prisma } from '@/lib/prisma';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { checkedOutAtWhere, type CheckinStatusFilter } from './checkinFilter';

/**
 * Platform Check-ins list — viewer-scoped counts and rows for the Check-ins page.
 *
 * Every query is constrained to `viewer.siteIds` (the RBAC + site-scoping
 * boundary resolved upstream: all sites for a Director, Assigned Sites for every
 * other role). The status-filter counts are therefore over ONLY the records the
 * current user may see. A viewer with no sites in scope sees zero of everything.
 */

export interface CheckinCounts {
  all: number;
  onSite: number;
  checkedOut: number;
}

export interface CheckinListItem {
  id: string;
  checkedInAt: Date;
  checkedOutAt: Date | null;
  // BL-001 — carried on every row so the list, the rail and the export all
  // describe a manual close the same way, from one read.
  checkedOutManual: boolean;
  checkedOutByName: string | null;
  checkedOutByRole: string | null;
  checkedOutReason: string | null;
  worker: { id: string; fullName: string; company: string };
  jobSite: { name: string };
}

/** Live per-category counts, scoped to the viewer's sites. */
export async function getCheckinCounts(
  viewer: PlatformViewer,
  siteId?: string | null,
): Promise<CheckinCounts> {
  if (viewer.siteIds.length === 0) return { all: 0, onSite: 0, checkedOut: 0 };
  // A chosen site narrows the counts too, so the tab pills describe the list
  // actually on screen. Showing org-wide counts above a site-filtered table
  // would state a number the rows below contradict.
  const where = {
    jobSiteId: siteId ? siteId : { in: viewer.siteIds },
  };
  const [all, onSite] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.count({ where: { ...where, checkedOutAt: null } }),
  ]);
  return { all, onSite, checkedOut: all - onSite };
}

/**
 * One page of check-ins for the viewer, newest first, narrowed by `filter`.
 *
 * This used to take a bare `take` defaulting to 25 and no offset, so the page
 * could only ever show the 25 most recent records — while the status pills above
 * it reported the true totals. Every check-in older than the 25th was
 * unreachable. `skip`/`take` come from resolvePage() in lib/pagination.ts, the
 * same helper Documents, Audits and Actions use.
 *
 * Paging cannot widen access: `skip`/`take` only slice a result set that the
 * `where` clause has already constrained to the viewer's sites.
 */
export async function listCheckinsForViewer(
  viewer: PlatformViewer,
  filter: CheckinStatusFilter,
  siteId?: string | null,
  opts: { skip?: number; take?: number } = {},
): Promise<CheckinListItem[]> {
  if (viewer.siteIds.length === 0) return [];
  // `siteId` is already validated against the viewer's own sites by
  // parseCheckinSiteFilter, so narrowing to it can only ever be a subset of the
  // scoped set — it cannot widen access.
  return prisma.submission.findMany({
    where: {
      jobSiteId: siteId ? siteId : { in: viewer.siteIds },
      ...checkedOutAtWhere(filter),
    },
    orderBy: { checkedInAt: 'desc' },
    skip: opts.skip ?? 0,
    take: opts.take ?? DEFAULT_PAGE_SIZE,
    select: {
      id: true,
      checkedInAt: true,
      checkedOutAt: true,
      checkedOutManual: true,
      checkedOutByName: true,
      checkedOutByRole: true,
      checkedOutReason: true,
      worker: { select: { id: true, fullName: true, company: true } },
      jobSite: { select: { name: true } },
    },
  });
}
