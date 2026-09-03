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

/**
 * One page of the list view, newest first.
 *
 * Replaces a flat 1,000-row cap: past that ceiling the remaining check-ins were
 * simply unreachable in the UI and the only route to them was the CSV export.
 * `skip`/`take` come from resolvePage() in lib/pagination.ts, so an out-of-range
 * ?page= is clamped before it reaches here.
 *
 * THE TIEBREAKER IS LOAD-BEARING. checkedInAt alone is not unique — a gang
 * checking in together shares a timestamp to the second — and a non-unique sort
 * lets rows swap between pages, so the same record can appear on two pages while
 * another is never shown at all. `id` makes the order total. This is the same
 * fix already carried by checkinSort.ts and by Actions, Audits, Documents and
 * Permits.
 */
export async function querySubmissions(
  filters: SubmissionFilters,
  paging?: { skip: number; take: number },
) {
  return prisma.submission.findMany({
    where: buildWhere(filters),
    orderBy: [{ checkedInAt: 'desc' }, { id: 'asc' }],
    skip: paging?.skip,
    take: paging?.take,
    include: ROW_INCLUDE,
  });
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
    // Same total ordering as the list, so the CSV matches what was on screen
    // and two exports of one filter set come out in the same order.
    orderBy: [{ checkedInAt: 'desc' }, { id: 'asc' }],
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
