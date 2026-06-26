import { Prisma, SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ukDateRangeToUtc } from '@/lib/datetime';

/**
 * Read/reporting queries over submissions for the admin: filter by site, worker
 * (name/company) and check-in date range, plus a detail view that resolves each
 * answer against the exact checklist version the worker completed.
 */

export interface SubmissionFilters {
  siteId?: string;
  q?: string; // worker name or company
  from?: string; // yyyy-mm-dd (UK local, inclusive)
  to?: string; // yyyy-mm-dd (UK local, inclusive)
  status?: string;
}

const MAX_ROWS = 1000;

function buildWhere(filters: SubmissionFilters): Prisma.SubmissionWhereInput {
  const where: Prisma.SubmissionWhereInput = {};

  if (filters.siteId) where.jobSiteId = filters.siteId;

  if (
    filters.status === SubmissionStatus.COMPLIANT ||
    filters.status === SubmissionStatus.INCOMPLETE
  ) {
    where.status = filters.status;
  }

  const range = ukDateRangeToUtc(filters.from, filters.to);
  if (range.gte || range.lt) where.checkedInAt = range;

  const q = filters.q?.trim();
  if (q) {
    where.worker = {
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  return where;
}

export async function querySubmissions(filters: SubmissionFilters) {
  return prisma.submission.findMany({
    where: buildWhere(filters),
    orderBy: { checkedInAt: 'desc' },
    take: MAX_ROWS,
    include: {
      worker: { select: { fullName: true, company: true, mobile: true } },
      jobSite: { select: { name: true, jobReference: true } },
    },
  });
}

export type SubmissionRow = Awaited<
  ReturnType<typeof querySubmissions>
>[number];

/** Sites for the filter dropdown (all statuses). */
export function listSitesForFilter() {
  return prisma.jobSite.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, jobReference: true },
  });
}

/**
 * A submission with its worker, site and the checklist items for the exact
 * version answered, so every item can be shown with the worker's response.
 */
export async function getSubmissionDetail(id: string) {
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      worker: true,
      jobSite: true,
    },
  });
  if (!submission) return null;

  const checklist = await prisma.complianceChecklist.findFirst({
    where: {
      jobSiteId: submission.jobSiteId,
      version: submission.checklistVersion,
    },
    include: { items: { orderBy: { order: 'asc' } } },
  });

  return { submission, items: checklist?.items ?? [] };
}
