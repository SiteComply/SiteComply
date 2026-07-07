import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getFindingEvidenceForViewer } from '@/services/audits/findingEvidenceService';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/audit-findings/[findingId]/evidence/[evidenceId]/download
 * Stream a finding's evidence file — only after the audits "view" permission and
 * the Assigned-Sites boundary pass. Images are served inline (thumbnails render);
 * everything else downloads. nosniff blocks MIME confusion, and only
 * non-executable types are ever accepted.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { findingId: string; evidenceId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'audits', 'view')) {
    return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }

  const ev = await getFindingEvidenceForViewer(viewer, params.findingId, params.evidenceId);
  if (!ev) {
    return NextResponse.json({ ok: false, error: 'Evidence not found.' }, { status: 404 });
  }

  const bytes = await downloadDocumentBlob(ev.blobPath);
  if (!bytes) {
    return NextResponse.json(
      { ok: false, error: 'The file is no longer available.' },
      { status: 404 },
    );
  }

  const isImage = ev.mimeType.startsWith('image/');
  const safeName = ev.fileName.replace(/["\r\n]/g, '_');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': ev.mimeType || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${isImage ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
