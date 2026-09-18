import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';
import { getApprovalSignatureBlobPath } from '@/services/sites/cppRevisionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The approver's drawn signature for one CPP revision.
 *
 * Served through the app rather than from a public blob URL, so the same site
 * scope that governs the plan governs the signature on it. Mirrors the induction
 * signature route beside it.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; revisionId: string } },
) {
  const viewer = await requirePlatformViewer();
  const blobPath = await getApprovalSignatureBlobPath(
    viewer,
    params.id,
    params.revisionId,
  );
  if (!blobPath) {
    return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }
  const buffer = await downloadDocumentBlob(blobPath);
  if (!buffer) {
    return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="cpp-approval-signature.png"',
      'Cache-Control': 'private, no-store',
    },
  });
}
