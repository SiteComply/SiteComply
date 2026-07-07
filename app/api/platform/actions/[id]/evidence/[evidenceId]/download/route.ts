import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getActionEvidenceForViewer } from '@/services/actions/actionEvidenceService';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/actions/[id]/evidence/[evidenceId]/download
 * Stream an action's evidence file — only after the actions "view" permission
 * and the Assigned-Sites boundary pass (anyone with access to the action can view
 * its evidence). The blob is private; this is the only way it is exposed. Images
 * are served inline (so thumbnails render); everything else downloads. nosniff
 * blocks MIME-confusion, and only non-executable types are ever accepted.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; evidenceId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'actions', 'view')) {
    return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }

  const ev = await getActionEvidenceForViewer(viewer, params.id, params.evidenceId);
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
