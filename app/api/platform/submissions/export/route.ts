import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toCsv } from '@/lib/csv';
import { formatDateTimeUK } from '@/lib/datetime';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { manualActorLabel } from '@/services/submissions/manualCheckOut';
import {
  parseCheckinStatusFilter,
  parseCheckinSiteFilter,
  checkedOutAtWhere,
} from '@/services/submissions/checkinFilter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/submissions/export
 * Exports check-in records (worker-level data) as CSV. Enforces the RBAC
 * check-ins export permission — allowed for Director, Project Manager, Site
 * Manager, Auditor, H&S Consultant and Principal Contractor; refused for
 * Engineer and Client. Scoped to the viewer's accessible sites only.
 */
export async function GET(req: NextRequest) {
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

  // The export now mirrors the workspace filters. It previously exported the
  // whole scoped set regardless, so a user who had filtered to one site and one
  // status got a file containing records they were not looking at — easy to
  // misread now the screen states "Showing 1-20 of N".
  //
  // The SAME helpers the page uses are applied here, so the two cannot drift:
  // parseCheckinSiteFilter validates the site against the viewer's own sites,
  // and checkedOutAtWhere translates the status filter.
  const sp = req.nextUrl.searchParams;
  const status = parseCheckinStatusFilter(sp.get('status') ?? undefined);
  const siteId = parseCheckinSiteFilter(sp.get('site') ?? undefined, viewer.siteIds);

  const where = {
    jobSiteId: siteId ? siteId : { in: viewer.siteIds },
    ...checkedOutAtWhere(status),
  };

  const submissions = viewer.siteIds.length
    ? await prisma.submission.findMany({
        where,
        orderBy: { checkedInAt: 'desc' },
        select: {
          checkedInAt: true,
          checkedOutAt: true,
          status: true,
          checkedOutManual: true,
          checkedOutByName: true,
          checkedOutByRole: true,
          checkedOutReason: true,
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
    // BL-001 — a manual close must be identifiable in the export too, or the
    // spreadsheet becomes the one place it looks like an ordinary check-out.
    'Manual check-out',
    'Checked out by',
    'Check-out reason',
  ];
  const rows = submissions.map((s) => [
    s.worker.fullName,
    s.worker.company,
    s.jobSite.name,
    s.jobSite.jobReference,
    formatDateTimeUK(s.checkedInAt),
    s.checkedOutAt ? formatDateTimeUK(s.checkedOutAt) : '',
    s.status,
    s.checkedOutManual ? 'Yes' : '',
    s.checkedOutManual ? manualActorLabel(s) : '',
    s.checkedOutManual ? (s.checkedOutReason ?? '') : '',
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
