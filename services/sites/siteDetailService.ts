import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  getComplianceSummary,
  type ComplianceSummary,
} from '@/services/reports/complianceReport';

/**
 * Site drill-down aggregate for the Platform → Site Details page.
 *
 * Site-scoping is enforced up front: `getSiteDetailForViewer` returns null unless
 * the site is one of the viewer's Assigned Sites (all sites for a Director), so a
 * user can never open a site outside their access. Every sub-query is constrained
 * to that one site. Audits/actions for the site are fetched by the page via the
 * existing viewer-scoped services (which also gate by module permission).
 */

export interface SiteDetailWorker {
  workerId: string;
  fullName: string;
  company: string;
  checkedInAt: Date;
}

export interface SiteDetailSubmission {
  id: string;
  workerId: string;
  workerName: string;
  company: string;
  status: string;
  checkedInAt: Date;
  checkedOutAt: Date | null;
}

export interface SiteDetail {
  site: {
    id: string;
    name: string;
    jobReference: string;
    addressLine1: string;
    town: string;
    postcode: string;
    status: 'ACTIVE' | 'ARCHIVED';
    createdAt: Date;
  };
  onSiteCount: number;
  currentWorkers: SiteDetailWorker[];
  recentSubmissions: SiteDetailSubmission[];
  compliance: ComplianceSummary;
}

export async function getSiteDetailForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<SiteDetail | null> {
  if (!viewer.siteIds.includes(siteId)) return null; // out of scope → not found

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      name: true,
      jobReference: true,
      addressLine1: true,
      town: true,
      postcode: true,
      status: true,
      createdAt: true,
    },
  });
  if (!site) return null;

  // Current workers = those with an open (not checked-out) submission on this site.
  const onSite = await prisma.submission.findMany({
    where: { jobSiteId: siteId, checkedOutAt: null },
    orderBy: { checkedInAt: 'desc' },
    select: {
      checkedInAt: true,
      worker: { select: { id: true, fullName: true, company: true } },
    },
  });
  const seen = new Set<string>();
  const currentWorkers: SiteDetailWorker[] = [];
  for (const s of onSite) {
    if (seen.has(s.worker.id)) continue; // one row per worker (latest open check-in)
    seen.add(s.worker.id);
    currentWorkers.push({
      workerId: s.worker.id,
      fullName: s.worker.fullName,
      company: s.worker.company,
      checkedInAt: s.checkedInAt,
    });
  }

  const recent = await prisma.submission.findMany({
    where: { jobSiteId: siteId },
    orderBy: { checkedInAt: 'desc' },
    take: 10,
    select: {
      id: true,
      status: true,
      checkedInAt: true,
      checkedOutAt: true,
      worker: { select: { id: true, fullName: true, company: true } },
    },
  });
  const recentSubmissions: SiteDetailSubmission[] = recent.map((s) => ({
    id: s.id,
    workerId: s.worker.id,
    workerName: s.worker.fullName,
    company: s.worker.company,
    status: s.status,
    checkedInAt: s.checkedInAt,
    checkedOutAt: s.checkedOutAt,
  }));

  // Reuse the compliance report aggregate (all-time) for this single site.
  const compliance = await getComplianceSummary([siteId], {});

  return {
    site,
    onSiteCount: currentWorkers.length,
    currentWorkers,
    recentSubmissions,
    compliance,
  };
}
