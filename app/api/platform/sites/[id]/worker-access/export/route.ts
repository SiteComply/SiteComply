import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canManageWorkerAccess,
  listSiteAssignments,
} from '@/services/workerAccess/workerAssignmentService';
import { toCsv } from '@/lib/csv';
import { formatDateUK, formatDateTimeUK } from '@/lib/datetime';
import { logReportExport } from '@/services/reports/reportExportLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/sites/[id]/worker-access/export — the assignment register.
 *
 * SC-023 Phase 2. Gated on the same capability as the register itself, and
 * logged through the existing ReportExportLog: this file contains workers'
 * names, companies and mobile numbers, so who took a copy and when is worth
 * recording for the same reason the other personal-data exports are.
 *
 * The derived window state is exported alongside the raw dates, so a
 * spreadsheet says "Expired" rather than leaving the reader to work it out
 * from a date and today's date.
 */
const WINDOW_LABEL: Record<string, string> = {
  none: '—',
  active: 'Within dates',
  pending: 'Not started',
  expired: 'Expired',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!canManageWorkerAccess(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot export this register.' },
      { status: 403 },
    );
  }

  const data = await listSiteAssignments(viewer, params.id);
  if (!data) {
    return NextResponse.json(
      { ok: false, error: 'Not found.' },
      { status: 404 },
    );
  }

  const csv = toCsv(
    [
      'Worker',
      'Company',
      'Mobile',
      'Status',
      'Role',
      'Access from',
      'Access to (inclusive)',
      'Date status',
      'Invited by',
      'Invited at',
      'Approved by',
      'Approved at',
      'Transferred from',
      'Existing worker',
    ],
    data.rows.map((r) => [
      r.workerName,
      r.company,
      r.mobile,
      r.status,
      r.role ?? '—',
      r.startDate ? formatDateUK(r.startDate) : '—',
      r.endDate ? formatDateUK(r.endDate) : '—',
      WINDOW_LABEL[r.windowState] ?? r.windowState,
      r.invitedByName ?? '—',
      formatDateTimeUK(r.invitedAt),
      r.approvedByName ?? '—',
      r.approvedAt ? formatDateTimeUK(r.approvedAt) : '—',
      r.transferredFromSiteName ?? '—',
      r.backfilled ? 'Yes' : 'No',
    ]),
  );

  await logReportExport({
    platformUserId: viewer.id,
    role: viewer.role as never,
    reportType: 'worker-assignments',
    format: 'csv',
    siteIds: [params.id],
    rowCount: data.rows.length,
  }).catch(() => {});

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="site-access-register.csv"`,
    },
  });
}
