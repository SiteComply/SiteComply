import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getWorkforceSummary } from '@/services/reports/workforceReport';
import { logReportExport } from '@/services/reports/reportExportLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT = getReportType('workforce')!;

/**
 * GET /api/platform/reports/workforce/export
 * Company breakdown CSV (aggregate). Gated by the reports-export permission
 * (Client & Engineer refused), scoped to the viewer's sites, logged.
 */
export async function GET(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!canExportReport(viewer, REPORT)) {
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

  const summary = await getWorkforceSummary(filters.siteIds, filters.range);
  const csv = toCsv(
    ['Company', 'Unique workers', 'Check-ins'],
    summary.byCompany.map((c) => [c.company, c.workers, c.checkIns]),
  );

  await logReportExport({
    platformUserId: viewer.id,
    role: viewer.role as PlatformRole,
    reportType: REPORT.id,
    format: 'csv',
    siteIds: filters.siteIds,
    dateFrom: filters.range.gte ?? null,
    dateTo: filters.range.lt ?? null,
    rowCount: summary.byCompany.length,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="workforce-${filters.fromStr}_${filters.toStr}.csv"`,
    },
  });
}
