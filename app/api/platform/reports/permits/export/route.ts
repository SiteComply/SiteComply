import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { formatDateTimeUK } from '@/lib/datetime';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getPermitReportRows } from '@/services/reports/permitsReport';
import { logReportExport } from '@/services/reports/reportExportLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT = getReportType('permits')!;

/**
 * GET /api/platform/reports/permits/export (SC-009)
 * Permit-to-work CSV over a date range. Enforces the reports-export permission
 * and the Assigned-Sites boundary; every export is written to ReportExportLog.
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

  const rows = await getPermitReportRows(filters.siteIds, filters.range);
  const csv = toCsv(
    [
      'Reference',
      'Type',
      'Worker',
      'Company',
      'Site',
      'Site reference',
      'Status',
      'Submitted',
      'Approved by',
      'Approved on',
      'Valid from',
      'Valid until',
      'Work location',
      'Rejection reason',
    ],
    rows.map((r) => [
      r.reference,
      r.permitType,
      r.workerName,
      r.workerCompany,
      r.siteName,
      r.siteRef,
      r.status,
      formatDateTimeUK(r.submittedAt),
      r.approvedByName ?? '',
      r.approvedAt ? formatDateTimeUK(r.approvedAt) : '',
      r.validFrom ? formatDateTimeUK(r.validFrom) : '',
      r.validUntil ? formatDateTimeUK(r.validUntil) : '',
      r.workLocation ?? '',
      r.rejectionReason ?? '',
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
      'Content-Disposition': `attachment; filename="permits-${filters.fromStr}_${filters.toStr}.csv"`,
    },
  });
}
