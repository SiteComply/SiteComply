import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { formatDateTimeUK } from '@/lib/datetime';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getAttendanceRows } from '@/services/reports/attendanceReport';
import { logReportExport } from '@/services/reports/reportExportLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT = getReportType('attendance')!;

/**
 * GET /api/platform/reports/attendance/export
 * Worker-level check-in CSV. Enforces the reports-export permission (Client &
 * Engineer refused) and the Assigned-Sites boundary; the same Site/Date filters
 * as the on-screen report; every export is written to ReportExportLog.
 */
export async function GET(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!canExportReport(viewer, REPORT)) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to export this report.' },
      { status: 403 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const filters = parseReportFilters(
    { from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, sites: sp.getAll('sites') },
    viewer,
  );

  const rows = await getAttendanceRows(filters.siteIds, filters.range);
  const csv = toCsv(
    ['Worker', 'Company', 'Site', 'Site reference', 'Checked in', 'Checked out', 'Status'],
    rows.map((r) => [
      r.workerName,
      r.workerCompany,
      r.siteName,
      r.siteRef,
      formatDateTimeUK(r.checkedInAt),
      r.checkedOutAt ? formatDateTimeUK(r.checkedOutAt) : '',
      r.status,
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
    rowCount: rows.length,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="attendance-${filters.fromStr}_${filters.toStr}.csv"`,
    },
  });
}
