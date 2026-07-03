import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getDocumentForViewer } from '@/services/documents/documentService';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/documents/[id]/download
 * Stream a document's file back to the client — ONLY after the documents "view"
 * permission and the Assigned-Sites boundary pass. The blob is private; this is
 * the only way to retrieve a file (no public blob URL is ever exposed).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'documents', 'view')) {
    return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }

  const doc = await getDocumentForViewer(viewer, params.id);
  if (!doc) {
    return NextResponse.json(
      { ok: false, error: 'Document not found.' },
      { status: 404 },
    );
  }

  const bytes = await downloadDocumentBlob(doc.blobPath);
  if (!bytes) {
    return NextResponse.json(
      { ok: false, error: 'The file is no longer available.' },
      { status: 404 },
    );
  }

  // Attach the original filename; sanitise for the header.
  const safeName = doc.fileName.replace(/["\r\n]/g, '_');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': doc.mimeType || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
