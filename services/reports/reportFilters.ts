import {
  addDaysToDateStr,
  toDateInputValue,
  ukDateRangeToUtc,
} from '@/lib/datetime';
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
}

export function parseReportFilters(
  raw: { from?: string; to?: string; sites?: string[] },
  viewer: PlatformViewer,
): ReportFilters {
  const today = toDateInputValue(new Date());
  let toStr = raw.to && ISO.test(raw.to) ? raw.to : today;
  let fromStr =
    raw.from && ISO.test(raw.from) ? raw.from : addDaysToDateStr(toStr, -29);
  if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr]; // tolerate reversed range

  const requested = raw.sites && raw.sites.length ? raw.sites : null;
  const siteIds = resolveReportScope(viewer, requested ?? undefined);

  return {
    fromStr,
    toStr,
    range: ukDateRangeToUtc(fromStr, toStr),
    siteIds,
    requestedSiteIds: requested,
  };
}

/** Serialise the current filters back into a query string (export links, etc.). */
export function reportFiltersQuery(filters: ReportFilters): string {
  const p = new URLSearchParams();
  p.set('from', filters.fromStr);
  p.set('to', filters.toStr);
  (filters.requestedSiteIds ?? []).forEach((id) => p.append('sites', id));
  return p.toString();
}
