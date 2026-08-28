import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canRunReport, canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getOrgOverview } from '@/services/reports/orgOverviewReport';
import { logReportExport } from '@/services/reports/reportExportLog';
import { percentCell } from '@/services/reports/reportFormat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT = getReportType('org-overview')!;

/**
 * GET /api/platform/reports/org-overview/export
 * Per-site performance CSV for the organisation (aggregate). Director-only
 * (canRunReport is Director-only for this report; export also permission-gated).
 * Scoped to accessible sites, logged.
 */
export async function GET(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!canRunReport(viewer, REPORT) || !canExportReport(viewer, REPORT)) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to export this report.' },
      { status: 403 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const filters = await parseReportFilters(
    {
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      sites: sp.getAll('sites'),
      // SC-025 — carried through so an export matches exactly what the screen
      // showed. Without this a CSV would silently exclude completed projects
      // even when the user had asked to include them.
      includeCompleted: sp.get('includeCompleted') ?? undefined,
    },
    viewer,
  );

  const scopeSites = viewer.sites.filter((s) => filters.siteIds.includes(s.id));
  const o = await getOrgOverview(scopeSites, filters.range);
  const csv = toCsv(
    ['Site', 'Check-ins', 'Active workers', 'On site now', 'Compliance %'],
    o.sitePerformance.map((s) => [
      s.siteName,
      s.checkIns,
      s.workers,
      s.onSiteNow,
      percentCell(s.compliancePct),
    ]),
  );

  await logReportExport({
    platformUserId: viewer.id,
    role: viewer.role as PlatformRole,
    reportType: REPORT.id,
    format: 'csv',
    siteIds: filters.siteIds,
    dateFrom: filters.range.gte ?? null,
    dateTo: filters.range.lt ?? null,
    rowCount: o.sitePerformance.length,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="organisation-overview-${filters.fromStr}_${filters.toStr}.csv"`,
    },
  });
}
