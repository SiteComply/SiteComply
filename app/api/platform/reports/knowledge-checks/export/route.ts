import { NextRequest, NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { formatDateTimeUK } from '@/lib/datetime';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getReportType } from '@/services/reports/reportRegistry';
import { canExportReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getKnowledgeCheckRows } from '@/services/reports/knowledgeCheckReport';
import { logReportExport } from '@/services/reports/reportExportLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPORT = getReportType('knowledge-checks')!;

/**
 * GET /api/platform/reports/knowledge-checks/export
 * Worker-level knowledge-check CSV (SC-005). Enforces the reports-export
 * permission (Client & Engineer refused) and the Assigned-Sites boundary; same
 * Site/Date filters as the on-screen report; every export is audit-logged.
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

  const rows = await getKnowledgeCheckRows(filters.siteIds, filters.range);
  const csv = toCsv(
    [
      'Worker',
      'Company',
      'Site',
      'Site reference',
      'Completed',
      'Questions',
      'Time (s)',
    ],
    rows.map((r) => [
      r.workerName,
      r.workerCompany,
      r.siteName,
      r.siteRef,
      r.completedAt ? formatDateTimeUK(r.completedAt) : '',
      String(r.questionCount),
      r.durationSeconds != null ? String(r.durationSeconds) : '',
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
      'Content-Disposition': `attachment; filename="knowledge-checks-${filters.fromStr}_${filters.toStr}.csv"`,
    },
  });
}
