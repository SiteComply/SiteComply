import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getScorecard } from '@/services/reports/scorecardReport';
import { logReportExport } from '@/services/reports/reportExportLog';
import { percentCell } from '@/services/reports/reportFormat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT = getReportType('scorecard')!;

/**
 * GET /api/platform/reports/scorecard/export
 * Per-site scorecard CSV (aggregate). Gated by the reports-export permission
 * (Client & Engineer refused), scoped to the viewer's sites, logged. Audit &
 * action columns are placeholders until those modules exist.
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

  const scopeSites = viewer.sites.filter((s) => filters.siteIds.includes(s.id));
  const scorecard = await getScorecard(scopeSites, filters.range);
  const csv = toCsv(
    [
      'Site',
      'Check-ins',
      'Active workers',
      'Contractors',
      'Compliance %',
      'Induction %',
      'Audits',
      'Actions',
    ],
    scorecard.rows.map((r) => [
      r.siteName,
      r.checkIns,
      r.activeWorkers,
      r.companies,
      percentCell(r.compliancePct),
      percentCell(r.inductionPct),
      '',
      '',
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
    rowCount: scorecard.rows.length,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="site-scorecard-${filters.fromStr}_${filters.toStr}.csv"`,
    },
  });
}
