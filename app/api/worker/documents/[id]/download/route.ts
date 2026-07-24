import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { getDocumentForCheckedInWorker } from '@/services/workerDashboard/workerDashboardService';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/documents/[id]/download
 *
 * Streams a site document (RAMS or other site paperwork) to a worker who is
 * currently checked into that document's site — the Worker Dashboard's only
 * route to a file. Three things must hold, and all three are re-derived server
 * side rather than taken from the request:
 *   1. a valid worker session (SMS-verified mobile),
 *   2. an OPEN check-in for that worker, and
 *   3. the document belonging to that check-in's site.
 *
 * A worker who has checked out loses access immediately. Blobs stay private; no
 * public URL is ever issued.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired.' },
      { status: 401 },
    );
  }

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) {
    return NextResponse.json(
      { ok: false, error: 'Worker not found.' },
      { status: 401 },
    );
  }

  const doc = await getDocumentForCheckedInWorker(worker.id, params.id);
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

  // Inline so a worker can read a RAMS PDF on their phone without downloading.
  const safeName = doc.fileName.replace(/["\r\n]/g, '_');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': doc.mimeType || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
