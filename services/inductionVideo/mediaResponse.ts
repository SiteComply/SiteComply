import { NextRequest, NextResponse } from 'next/server';
import { mediaProperties, readMedia } from '@/services/inductionVideo/mediaStorage';
import { parseRangeHeader } from '@/services/inductionVideo/byteRange';

/**
 * Handing private media back to a browser, byte ranges included.
 *
 * ── WHY RANGE SUPPORT IS THE POINT OF THIS FILE ───────────────────────────
 *
 * A media element does not download a file and play it. It asks for a few bytes
 * to read the headers, often asks for the end of the file to find the duration,
 * and asks for a fresh range every time the listener drags the scrubber. A route
 * that ignores `Range` and always returns 200 with the whole body makes seeking
 * impossible, and Safari - which requires a 206 before it will play at all -
 * shows an operative a dead player with no error.
 *
 * So the header is parsed here, the range travels down to the blob, and only
 * those bytes are read into memory. That is also what keeps a Phase 3 MP4 off
 * the heap of a single B1 instance: a 40 MB file served in 2 MB windows.
 *
 * ── STILL PRIVATE ─────────────────────────────────────────────────────────
 *
 * Callers pass a blob path they have already authorised. Nothing here checks
 * permission and nothing here is cacheable: `no-store`, so a shared cache or a
 * proxy cannot keep a site's induction audio for the next person along.
 */

export async function streamMedia(
  req: NextRequest,
  blobPath: string,
  opts: { fileName?: string; contentType?: string; download?: boolean } = {},
): Promise<NextResponse> {
  // Properties first, not bytes: a player's opening request needs the length and
  // the type, and reading the whole blob to answer it would defeat the point.
  const props = await mediaProperties(blobPath);
  if (!props) {
    return NextResponse.json(
      { ok: false, error: 'That file is no longer available.' },
      { status: 404 },
    );
  }
  const totalLength = props.totalLength;
  const contentType = opts.contentType || props.contentType;
  const disposition = opts.fileName
    ? `${opts.download ? 'attachment' : 'inline'}; filename="${opts.fileName.replace(/["\r\n]/g, '_')}"`
    : undefined;

  const range = parseRangeHeader(req.headers.get('range'), totalLength);
  if (range === 'unsatisfiable') {
    return new NextResponse(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${totalLength}`, 'Accept-Ranges': 'bytes' },
    });
  }

  const media = await readMedia(blobPath, range ?? undefined);
  if (!media) {
    return NextResponse.json(
      { ok: false, error: 'That file is no longer available.' },
      { status: 404 },
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(media.bytes.length),
    // Advertised even on a 200: a player will not attempt a range request
    // against a route that has not said it can serve one.
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    ...(disposition ? { 'Content-Disposition': disposition } : {}),
  };
  if (range) {
    const last = range.offset + media.bytes.length - 1;
    headers['Content-Range'] = `bytes ${range.offset}-${last}/${totalLength}`;
  }

  return new NextResponse(media.bytes, { status: range ? 206 : 200, headers });
}
