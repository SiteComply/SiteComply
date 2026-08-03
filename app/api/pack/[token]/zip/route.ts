import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getStoredArchive } from '@/services/closeOut/closeOutArchive';
import { openDocumentBlobStream } from '@/services/documents/blobStorage';
import {
  resolveShare,
  recordShareView,
} from '@/services/closeOut/closeOutSharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 3 — download the ZIP from a share link.
 *
 * Only when the link was created WITH `includeZip`. The pack document is a
 * summary; the archive is every original file on the project, so handing one
 * out is a separate decision from handing out the other, and it is made when
 * the link is created rather than assumed here.
 *
 * The archive is streamed under the SHARER'S current permissions, exactly as
 * the page is.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const resolved = await resolveShare(params.token);
  if (!resolved.ok)
    return NextResponse.json(
      { ok: false, error: 'This link is not valid.' },
      { status: 404 },
    );

  const { share } = resolved;
  if (!share.includeZip)
    return NextResponse.json(
      { ok: false, error: 'This link does not include the file archive.' },
      { status: 403 },
    );

  const stored = await getStoredArchive(share.viewer, share.packId);
  if (!stored)
    return NextResponse.json(
      { ok: false, error: 'No archive is available for this pack.' },
      { status: 404 },
    );

  const stream = await openDocumentBlobStream(stored.blobPath);
  if (!stream)
    return NextResponse.json(
      { ok: false, error: 'The archive file is no longer available.' },
      { status: 404 },
    );

  await recordShareView(
    share.shareId,
    'ZIP',
    _req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      _req.headers.get('x-real-ip'),
  );

  const web = Readable.toWeb(
    Readable.from(stream),
  ) as unknown as ReadableStream<Uint8Array>;

  const safeName = stored.fileName.replace(/["\r\n]/g, '_');
  return new NextResponse(web, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
