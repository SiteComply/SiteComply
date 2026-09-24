import { NextRequest, NextResponse } from 'next/server';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { getPermitForViewer } from '@/services/permits/permitAdminService';
import {
  loadPermitRecord,
  permitRecordFilename,
} from '@/services/permitRecord/permitRecordData';
import { renderPermitRecordPdf } from '@/services/permitRecord/renderPermitRecord';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/permits/[id]/record — the same permit, the same document.
 *
 * The manager's copy is rendered by the same renderer from the same data as the
 * operative's, so the two cannot become different documents for one permit —
 * which is the whole point of a controlled record.
 *
 * Access is the module view plus the viewer's assigned sites, both enforced by
 * `getPermitForViewer` before anything is rendered.
 */
async function GETHandler(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'permits');

  const visible = await getPermitForViewer(viewer, params.id);
  if (!visible) {
    return NextResponse.json({ ok: false, error: 'Permit not found.' }, { status: 404 });
  }

  const data = await loadPermitRecord(params.id);
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Permit not found.' }, { status: 404 });
  }
  const pdf = await renderPermitRecordPdf(data);
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `inline; filename="${permitRecordFilename(data)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export const GET = withClosedProjectHandling(GETHandler);
