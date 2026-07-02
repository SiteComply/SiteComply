import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { formatDateUK } from '@/lib/datetime';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getCscsRows } from '@/services/reports/cscsReport';
import { logReportExport } from '@/services/reports/reportExportLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT = getReportType('cscs')!;
const STATUS_LABEL = { valid: 'Valid', expired: 'Expired', none: 'No card' } as const;

/**
 * GET /api/platform/reports/cscs/export
 * Worker-level CSCS detail CSV. Export is restricted (via the report's
 * `exportRoles`) to Director / Project Manager / Site Manager / H&S Consultant;
 * scoped to the viewer's sites; logged.
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

  const rows = await getCscsRows(filters.siteIds, filters.range);
  const csv = toCsv(
    ['Worker', 'Company', 'CSCS card', 'Card number', 'Expiry', 'Status'],
    rows.map((r) => [
      r.workerName,
      r.workerCompany,
      r.cardTypeLabel,
      r.cardNumber,
      r.expiry ? formatDateUK(r.expiry) : '',
      STATUS_LABEL[r.status],
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
      'Content-Disposition': 'attachment; filename="cscs-competency.csv"',
    },
  });
}
