import { prisma } from '@/lib/prisma';
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
  worker: { id: string; fullName: string; company: string };
  jobSite: { name: string };
}

/** Live per-category counts, scoped to the viewer's sites. */
export async function getCheckinCounts(
  viewer: PlatformViewer,
): Promise<CheckinCounts> {
  if (viewer.siteIds.length === 0) return { all: 0, onSite: 0, checkedOut: 0 };
  const where = { jobSiteId: { in: viewer.siteIds } };
  const [all, onSite] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.count({ where: { ...where, checkedOutAt: null } }),
  ]);
  return { all, onSite, checkedOut: all - onSite };
}

/** The (most recent `take`) check-ins for the viewer, narrowed by `filter`. */
export async function listCheckinsForViewer(
  viewer: PlatformViewer,
  filter: CheckinStatusFilter,
  take = 25,
): Promise<CheckinListItem[]> {
  if (viewer.siteIds.length === 0) return [];
  return prisma.submission.findMany({
    where: {
      jobSiteId: { in: viewer.siteIds },
      ...checkedOutAtWhere(filter),
    },
    orderBy: { checkedInAt: 'desc' },
    take,
    select: {
      id: true,
      checkedInAt: true,
      checkedOutAt: true,
      worker: { select: { id: true, fullName: true, company: true } },
      jobSite: { select: { name: true } },
    },
  });
}
