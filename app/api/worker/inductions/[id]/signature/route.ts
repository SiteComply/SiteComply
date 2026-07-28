import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { getSignatureBlobForWorker } from '@/services/inductionSignature/inductionRecordService';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/inductions/[id]/signature (SC-011)
 *
 * Streams the drawn signature PNG for one of the worker's OWN induction records.
 * Ownership is re-derived from the session (the submission must belong to this
 * worker); the blob stays private and is never issued as a public URL.
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

  const blobPath = await getSignatureBlobForWorker(worker.id, params.id);
  if (!blobPath) {
    return NextResponse.json(
      { ok: false, error: 'No signature image is available.' },
      { status: 404 },
    );
  }

  const bytes = await downloadDocumentBlob(blobPath);
  if (!bytes) {
    return NextResponse.json(
      { ok: false, error: 'The signature is no longer available.' },
      { status: 404 },
    );
  }

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      'Content-Disposition': 'inline; filename="induction-signature.png"',
      'Cache-Control': 'private, no-store',
    },
  });
}
