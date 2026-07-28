import { prisma } from '@/lib/prisma';
import { permitStatusLabel } from '@/services/permits/permitConstants';
import { effectiveStatus } from '@/services/permits/permitService';

/**
 * Permits to Work report (SC-009). Rows are already scoped to `siteIds` (the
 * viewer's Assigned Sites, intersected upstream) and filtered by submission date.
 * Personal data (worker names) — export is gated by the reports-export rules.
 */

type Range = { gte?: Date; lt?: Date };

export interface PermitReportRow {
  reference: string;
  permitType: string;
  workerName: string;
  workerCompany: string;
  siteName: string;
  siteRef: string;
  status: string;
  submittedAt: Date;
  approvedByName: string | null;
  approvedAt: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
  workLocation: string | null;
  rejectionReason: string | null;
}

export async function getPermitReportRows(
  siteIds: string[],
  range: Range,
): Promise<PermitReportRow[]> {
  if (!siteIds.length) return [];
  const rows = await prisma.permit.findMany({
    where: {
      jobSiteId: { in: siteIds },
      ...(range.gte || range.lt ? { submittedAt: range } : {}),
    },
    orderBy: { submittedAt: 'desc' },
    include: {
      jobSite: { select: { name: true, jobReference: true } },
      worker: { select: { fullName: true, company: true } },
    },
  });
  return rows.map((p) => ({
    reference: p.reference,
    permitType: p.permitTypeName,
    workerName: p.worker.fullName,
    workerCompany: p.worker.company,
    siteName: p.jobSite.name,
    siteRef: p.jobSite.jobReference,
    status: permitStatusLabel(effectiveStatus(p)),
    submittedAt: p.submittedAt,
    approvedByName: p.approvedByName,
    approvedAt: p.approvedAt,
    validFrom: p.validFrom,
    validUntil: p.validUntil,
    workLocation: p.workLocation,
    rejectionReason: p.rejectionReason,
  }));
}

export interface PermitReportSummary {
  total: number;
  awaiting: number;
  approved: number;
  rejected: number;
}

/** Aggregate-only figures (Client-safe: no worker-level rows). */
export async function getPermitReportSummary(
  siteIds: string[],
  range: Range,
): Promise<PermitReportSummary> {
  if (!siteIds.length)
    return { total: 0, awaiting: 0, approved: 0, rejected: 0 };
  const where = {
    jobSiteId: { in: siteIds },
    ...(range.gte || range.lt ? { submittedAt: range } : {}),
  };
  const [total, awaiting, approved, rejected] = await Promise.all([
    prisma.permit.count({ where }),
    prisma.permit.count({
      where: { ...where, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
    }),
    prisma.permit.count({ where: { ...where, status: 'APPROVED' } }),
    prisma.permit.count({ where: { ...where, status: 'REJECTED' } }),
  ]);
  return { total, awaiting, approved, rejected };
}
