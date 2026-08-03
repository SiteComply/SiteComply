import {
  addDaysToDateStr,
  toDateInputValue,
  ukDateRangeToUtc,
} from '@/lib/datetime';
import { prisma } from '@/lib/prisma';
import { resolveReportScope } from '@/services/reports/reportAccess';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';

/**
 * Parse the common report filters (Site, Date From, Date To) from request query
 * params, applying safe defaults and the Assigned-Sites boundary. Shared by the
 * report pages (server components) and their CSV export routes so on-screen and
 * exported data always use the same filters + scope.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportFilters {
  /** Inclusive UK local dates (yyyy-mm-dd) for display/inputs. */
  fromStr: string;
  toStr: string;
  /** UTC [gte, lt) range for querying `checkedInAt`. */
  range: { gte?: Date; lt?: Date };
  /** Effective site ids to query: requested ∩ accessible, or all accessible. */
  siteIds: string[];
  /** Raw requested site ids (for checkbox state); null = "all accessible". */
  requestedSiteIds: string[] | null;
  /** SC-025 — whether completed projects are included. Default false. */
  includeCompleted: boolean;
  /** How many accessible projects are completed, for the toggle's label. */
  completedCount: number;
}

/**
 * SC-025 — completed projects are EXCLUDED by default.
 *
 * A finished job should not drag a live compliance figure down for the rest of
 * the year: "82% of inspections completed" is about the work in progress. The
 * historical record is still reachable — this is a default, not a deletion, and
 * `includeCompleted` puts it back.
 *
 * Async because it now asks the database which projects are completed. Every
 * caller is an async server component or route handler; the compiler finds any
 * that forgets to await, because `.siteIds` does not exist on a Promise.
 */
export async function parseReportFilters(
  raw: {
    from?: string;
    to?: string;
    sites?: string[];
    includeCompleted?: string | boolean;
  },
  viewer: PlatformViewer,
): Promise<ReportFilters> {
  const today = toDateInputValue(new Date());
  let toStr = raw.to && ISO.test(raw.to) ? raw.to : today;
  let fromStr =
    raw.from && ISO.test(raw.from) ? raw.from : addDaysToDateStr(toStr, -29);
  if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr]; // tolerate reversed range

  const requested = raw.sites && raw.sites.length ? raw.sites : null;
  const scoped = resolveReportScope(viewer, requested ?? undefined);

  const includeCompleted =
    raw.includeCompleted === true ||
    raw.includeCompleted === '1' ||
    raw.includeCompleted === 'true';

  const completed = scoped.length
    ? await prisma.jobSite.findMany({
        where: { id: { in: scoped }, status: 'COMPLETED' },
        select: { id: true },
      })
    : [];
  const completedIds = new Set(completed.map((c) => c.id));

  const siteIds = includeCompleted
    ? scoped
    : scoped.filter((id) => !completedIds.has(id));

  return {
    fromStr,
    toStr,
    range: ukDateRangeToUtc(fromStr, toStr),
    siteIds,
    requestedSiteIds: requested,
    includeCompleted,
    completedCount: completedIds.size,
  };
}

/** Serialise the current filters back into a query string (export links, etc.). */
export function reportFiltersQuery(filters: ReportFilters): string {
  const p = new URLSearchParams();
  p.set('from', filters.fromStr);
  p.set('to', filters.toStr);
  (filters.requestedSiteIds ?? []).forEach((id) => p.append('sites', id));
  // Carried through so an export matches exactly what was on screen.
  if (filters.includeCompleted) p.set('includeCompleted', '1');
  return p.toString();
}
