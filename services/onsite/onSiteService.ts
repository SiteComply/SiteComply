import { SiteStatus, SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * "On site now" read model for the admin dashboard.
 *
 * A worker is on site when they have a submission with no checkedOutAt. We group
 * the current open check-ins by active site, with per-site compliance summaries.
 */

export interface OnSiteWorker {
  submissionId: string;
  fullName: string;
  company: string;
  checkedInAt: Date;
  status: SubmissionStatus;
}

export interface OnSiteSite {
  id: string;
  name: string;
  jobReference: string;
  workers: OnSiteWorker[];
  compliantCount: number;
}

export interface OnSiteSnapshot {
  sites: OnSiteSite[];
  totalOnSite: number;
  totalCompliant: number;
  generatedAt: Date;
}

export async function getOnSiteNow(): Promise<OnSiteSnapshot> {
  const sites = await prisma.jobSite.findMany({
    where: { status: SiteStatus.ACTIVE },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      jobReference: true,
      submissions: {
        where: { checkedOutAt: null },
        orderBy: { checkedInAt: 'desc' },
        select: {
          id: true,
          checkedInAt: true,
          status: true,
          worker: { select: { fullName: true, company: true } },
        },
      },
    },
  });

  let totalOnSite = 0;
  let totalCompliant = 0;

  const mapped: OnSiteSite[] = sites.map((site) => {
    const workers: OnSiteWorker[] = site.submissions.map((s) => ({
      submissionId: s.id,
      fullName: s.worker.fullName,
      company: s.worker.company,
      checkedInAt: s.checkedInAt,
      status: s.status,
    }));
    const compliantCount = workers.filter(
      (w) => w.status === SubmissionStatus.COMPLIANT,
    ).length;

    totalOnSite += workers.length;
    totalCompliant += compliantCount;

    return {
      id: site.id,
      name: site.name,
      jobReference: site.jobReference,
      workers,
      compliantCount,
    };
  });

  return {
    sites: mapped,
    totalOnSite,
    totalCompliant,
    generatedAt: new Date(),
  };
}
