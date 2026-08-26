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

/**
 * The LIST cap. The admin Check-ins screen renders every row it is given in one
 * page, so it stays bounded — but the screen now reports the TRUE total from
 * countSubmissions() alongside it and says so when the two differ. It used to
 * print `rows.length` as "N records found", which meant that past this cap it
 * stated the cap as though it were the total: a confident wrong answer.
 */
const LIST_MAX_ROWS = 1000;

/**
 * The EXPORT ceiling. This is NOT a truncation point — the export refuses and
 * explains itself rather than silently returning a short file. "Export CSV"
 * promises the filtered set, so returning part of it without saying so produces
 * a document that looks complete and is not, which is worse than an error.
 */
export const EXPORT_MAX_ROWS = 50_000;

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

/** Row shape shared by the list and the export, so the CSV cannot drift. */
const ROW_INCLUDE = {
  worker: { select: { fullName: true, company: true, mobile: true } },
  jobSite: { select: { name: true, jobReference: true } },
} as const;

/**
 * How many submissions match these filters, independent of any row cap.
 *
 * This is the number the screen reports. It has to come from its own count()
 * rather than the length of a capped result set, or it agrees with the rows on
 * screen and disagrees with reality.
 */
export async function countSubmissions(
  filters: SubmissionFilters,
): Promise<number> {
  return prisma.submission.count({ where: buildWhere(filters) });
}

/** The list view's page of rows — capped, newest first. */
export async function querySubmissions(filters: SubmissionFilters) {
  return prisma.submission.findMany({
    where: buildWhere(filters),
    orderBy: { checkedInAt: 'desc' },
    take: LIST_MAX_ROWS,
    include: ROW_INCLUDE,
  });
}

/** The number of rows the list view will show for these filters. */
export function listCap(): number {
  return LIST_MAX_ROWS;
}

/**
 * EVERY submission matching these filters, for the CSV export — deliberately
 * uncapped, because the button says "Export CSV" of the filtered set.
 *
 * The caller MUST check countSubmissions() against EXPORT_MAX_ROWS first and
 * refuse with an explanation above it. That ordering is what keeps this
 * uncapped query safe: it never runs on an unbounded result set.
 */
export async function querySubmissionsForExport(filters: SubmissionFilters) {
  return prisma.submission.findMany({
    where: buildWhere(filters),
    orderBy: { checkedInAt: 'desc' },
    include: ROW_INCLUDE,
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
