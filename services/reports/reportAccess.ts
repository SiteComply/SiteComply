import { permits } from '@/services/platformUsers/platformPermissions';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { REPORT_TYPES, type ReportType } from '@/services/reports/reportRegistry';

/**
 * Report-specific access & scope helpers, layered on the platform RBAC + site
 * scope. Pure functions (no Prisma) so they can be used by pages, export routes
 * and tests alike.
 */

/** Can the viewer run (view) this report? */
export function canRunReport(viewer: PlatformViewer, report: ReportType): boolean {
  if (report.directorOnly && !viewer.allSites) return false;
  return permits(viewer.role, 'reports', 'view');
}

/**
 * Can the viewer EXPORT this report? Requires the general reports-export
 * permission AND, when a report defines `exportRoles` (e.g. CSCS detail),
 * membership of that tighter set.
 */
export function canExportReport(
  viewer: PlatformViewer,
  report: ReportType,
): boolean {
  if (!permits(viewer.role, 'reports', 'export')) return false;
  if (report.exportRoles && !report.exportRoles.includes(viewer.role)) {
    return false;
  }
  return true;
}

/**
 * Whether the viewer should see aggregate-only output (no worker-level rows or
 * personal data) for this report. Clients are aggregate-only on any report that
 * carries worker-level data.
 */
export function isAggregateOnly(
  viewer: PlatformViewer,
  report: ReportType,
): boolean {
  return report.clientAggregateOnly && viewer.role === 'CLIENT';
}

/** The report catalogue the viewer may run, in registry order. */
export function getVisibleReports(viewer: PlatformViewer): ReportType[] {
  return REPORT_TYPES.filter((r) => canRunReport(viewer, r));
}

/**
 * The effective set of site ids a report should query for this viewer: the
 * requested sites intersected with the viewer's accessible sites (or all
 * accessible sites when none are requested). Guarantees the Assigned-Sites
 * boundary even if a stale/forged site id is submitted.
 */
export function resolveReportScope(
  viewer: PlatformViewer,
  requestedSiteIds?: string[],
): string[] {
  if (!requestedSiteIds || requestedSiteIds.length === 0) return viewer.siteIds;
  const allowed = new Set(viewer.siteIds);
  return requestedSiteIds.filter((id) => allowed.has(id));
}
