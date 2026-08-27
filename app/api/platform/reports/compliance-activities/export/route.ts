import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import {
  getComplianceActivityRows,
  countComplianceActivities,
  ACTIVITY_EXPORT_MAX_ROWS,
} from '@/services/reports/complianceActivityReport';
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

  // Counted BEFORE the rows are loaded, so the uncapped query below never runs
  // on an unbounded result set. The route refuses rather than truncating: the
  // screen tells the user to "export CSV for all", and a short file that looks
  // complete is worse than an error they can act on.
  const total = await countComplianceActivities(filters.siteIds, filters.range);
  if (total > ACTIVITY_EXPORT_MAX_ROWS) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `This export would contain ${total.toLocaleString('en-GB')} activities, ` +
          `which is above the ${ACTIVITY_EXPORT_MAX_ROWS.toLocaleString('en-GB')} limit. ` +
          `Narrow the date range or sites and try again.`,
        total,
        limit: ACTIVITY_EXPORT_MAX_ROWS,
      },
      { status: 413 },
    );
  }

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
