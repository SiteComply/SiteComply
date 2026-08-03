import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getComplianceActivityRows } from '@/services/reports/complianceActivityReport';
import { logReportExport } from '@/services/reports/reportExportLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT = getReportType('compliance-activities')!;

/**
 * GET /api/platform/reports/compliance-activities/export (SC-020 Phase 3)
 *
 * Scheduled compliance activities as CSV. Inherits the EXISTING reports-export
 * permission and the Assigned-Sites boundary rather than introducing a new rule,
 * and every export is written to ReportExportLog like any other.
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
      // showed.
      includeCompleted: sp.get('includeCompleted') ?? undefined,
    },
    viewer,
  );

  const rows = await getComplianceActivityRows(filters.siteIds, filters.range);
  const csv = toCsv(
    [
      'Activity',
      'Site',
      'Due date',
      'Due time',
      'Assigned to',
      'Status',
      'Overdue',
      'Escalated on',
      'Escalated to',
      'Completed on',
      'Completed by',
      'Audit score %',
    ],
    rows.map((r) => [
      r.activity,
      r.siteName,
      formatDateUK(`${r.dueDateLocal}T12:00:00Z`),
      r.timeOfDay,
      r.assignee,
      r.status,
      r.overdue ? 'Yes' : 'No',
      r.escalatedAt ? formatDateTimeUK(r.escalatedAt) : '',
      r.escalatedToRole ?? '',
      r.completedAt ? formatDateTimeUK(r.completedAt) : '',
      r.completedByName ?? '',
      r.auditScore === null ? '' : String(r.auditScore),
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
      'Content-Disposition': `attachment; filename="compliance-activities-${filters.fromStr}_${filters.toStr}.csv"`,
    },
  });
}
