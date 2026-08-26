import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  countSubmissions,
  querySubmissionsForExport,
  EXPORT_MAX_ROWS,
} from '@/services/submissions/submissionQueryService';
import { checkInReference } from '@/services/submissions/submissionService';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';
import { csvCell } from '@/lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/submissions/export?site=&q=&from=&to=&status=
 * Streams the filtered submissions as a CSV with British English headers and
 * UK date/time formatting. Admin only.
 *
 * Exports EVERY record matching the filters. It previously shared the list
 * view's 1000-row cap, so a filtered set larger than that produced a CSV that
 * looked complete and was not — with nothing in the file or the UI to say so.
 *
 * Above EXPORT_MAX_ROWS it refuses with 413 and asks for narrower filters
 * rather than returning a short file. An error the user can act on is better
 * than a truncated document they will file and trust.
 */
export async function GET(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const p = req.nextUrl.searchParams;
  const filters = {
    siteId: p.get('site') ?? undefined,
    q: p.get('q') ?? undefined,
    from: p.get('from') ?? undefined,
    to: p.get('to') ?? undefined,
    status: p.get('status') ?? undefined,
  };

  // Counted BEFORE the rows are loaded, so the uncapped query below can never
  // run on an unbounded result set.
  const total = await countSubmissions(filters);
  if (total > EXPORT_MAX_ROWS) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `This export would contain ${total.toLocaleString('en-GB')} records, ` +
          `which is above the ${EXPORT_MAX_ROWS.toLocaleString('en-GB')} limit. ` +
          `Narrow the date range, site or search and try again.`,
        total,
        limit: EXPORT_MAX_ROWS,
      },
      { status: 413 },
    );
  }

  const rows = await querySubmissionsForExport(filters);

  const headers = [
    'Site',
    'Job reference',
    'Worker',
    'Company',
    'Mobile',
    'Checked in',
    'Checked out',
    'Compliance status',
    'Check-in reference',
  ];

  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.jobSite.name,
        r.jobSite.jobReference,
        r.worker.fullName,
        r.worker.company,
        r.worker.mobile,
        formatDateTimeUK(r.checkedInAt),
        r.checkedOutAt ? formatDateTimeUK(r.checkedOutAt) : '',
        r.status === 'COMPLIANT' ? 'Compliant' : 'Incomplete',
        checkInReference(r.id),
      ]
        .map((v) => csvCell(v))
        .join(','),
    );
  }

  // Prepend a UTF-8 BOM so Excel opens the British characters correctly.
  const body = `﻿${lines.join('\r\n')}\r\n`;
  const filename = `sitecomply-submissions-${formatDateUK(new Date()).replace(/\//g, '-')}.csv`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
