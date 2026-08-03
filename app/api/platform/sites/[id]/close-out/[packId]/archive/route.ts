import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canGenerateCloseOutPack } from '@/services/closeOut/closeOutService';
import {
  buildAndStoreArchive,
  getStoredArchive,
} from '@/services/closeOut/closeOutArchive';
import { openDocumentBlobStream } from '@/services/documents/blobStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 2 — the ZIP export.
 *
 * POST builds the archive and stores it permanently against the project; GET
 * streams the stored artefact back. Both re-check the caller's access, and the
 * build re-runs the pack render, so an archive can never contain more than the
 * person requesting it may see.
 */

async function guard(packId: string) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'Not signed in.' },
        { status: 401 },
      ),
    };
  }
  if (!canGenerateCloseOutPack(viewer.role)) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'You cannot generate close-out packs.' },
        { status: 403 },
      ),
    };
  }
  return { viewer };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; packId: string } },
) {
  const { viewer, error } = await guard(params.packId);
  if (error) return error;

  const result = await buildAndStoreArchive(viewer!, params.packId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Could not build the archive.' },
      { status: result.error === 'Pack not found.' ? 404 : 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    sizeBytes: result.sizeBytes,
    fileCount: result.fileCount,
    truncated: result.truncated,
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; packId: string } },
) {
  const { viewer, error } = await guard(params.packId);
  if (error) return error;

  const stored = await getStoredArchive(viewer!, params.packId);
  if (!stored) {
    return NextResponse.json(
      { ok: false, error: 'No archive has been generated for this pack yet.' },
      { status: 404 },
    );
  }

  const stream = await openDocumentBlobStream(stored.blobPath);
  if (!stream) {
    return NextResponse.json(
      { ok: false, error: 'The archive file is no longer available.' },
      { status: 404 },
    );
  }

  // Streamed, never buffered: a 250 MB ceiling read into memory would be a
  // sizeable fraction of this App Service's RAM for a single download.
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
    },
  });
}
