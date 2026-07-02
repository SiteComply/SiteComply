import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toCsv } from '@/lib/csv';
import { formatDateTimeUK } from '@/lib/datetime';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/submissions/export
 * Exports check-in records (worker-level data) as CSV. Enforces the RBAC
 * check-ins export permission — allowed for Director, Project Manager, Site
 * Manager, Auditor, H&S Consultant and Principal Contractor; refused for
 * Engineer and Client. Scoped to the viewer's accessible sites only.
 */
export async function GET() {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'checkins', 'export')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to export check-ins.' },
      { status: 403 },
    );
  }

  const submissions = viewer.siteIds.length
    ? await prisma.submission.findMany({
        where: { jobSiteId: { in: viewer.siteIds } },
        orderBy: { checkedInAt: 'desc' },
        select: {
          checkedInAt: true,
          checkedOutAt: true,
          status: true,
          worker: { select: { fullName: true, company: true } },
          jobSite: { select: { name: true, jobReference: true } },
        },
      })
    : [];

  const header = [
    'Worker',
    'Company',
    'Site',
    'Site reference',
    'Checked in',
    'Checked out',
    'Status',
  ];
  const rows = submissions.map((s) => [
    s.worker.fullName,
    s.worker.company,
    s.jobSite.name,
    s.jobSite.jobReference,
    formatDateTimeUK(s.checkedInAt),
    s.checkedOutAt ? formatDateTimeUK(s.checkedOutAt) : '',
    s.status,
  ]);
  const csv = toCsv(header, rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="platform-check-ins.csv"',
    },
  });
}
