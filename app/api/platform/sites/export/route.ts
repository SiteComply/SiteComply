import { NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/sites/export
 * Exports the viewer's accessible sites as CSV. Enforces the RBAC export
 * permission (Clients, being read-only, are refused) and the Assigned-Sites
 * boundary (only the viewer's sites are included; Directors get all sites).
 */
function csvCell(value: string): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'sites', 'export')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to export sites.' },
      { status: 403 },
    );
  }

  const header = ['Name', 'Job reference', 'Town', 'Postcode', 'Status'];
  const rows = viewer.sites.map((s) => [
    s.name,
    s.jobReference,
    s.town,
    s.postcode,
    s.status,
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="platform-sites.csv"',
    },
  });
}
