import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { querySubmissions } from '@/services/submissions/submissionQueryService';
import { checkInReference } from '@/services/submissions/submissionService';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Quote a CSV field, escaping embedded quotes; always quoted for safety. */
function csv(value: string): string {
  return `"${(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * GET /api/admin/submissions/export?site=&q=&from=&to=&status=
 * Streams the filtered submissions as a CSV with British English headers and
 * UK date/time formatting. Admin only.
 */
export async function GET(req: NextRequest) {
  const admin = getAdminSession();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  const p = req.nextUrl.searchParams;
  const rows = await querySubmissions({
    siteId: p.get('site') ?? undefined,
    q: p.get('q') ?? undefined,
    from: p.get('from') ?? undefined,
    to: p.get('to') ?? undefined,
    status: p.get('status') ?? undefined,
  });

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

  const lines = [headers.map(csv).join(',')];
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
        .map((v) => csv(String(v)))
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
