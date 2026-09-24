import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { renderPack } from '@/services/closeOut/closeOutService';
import { collectAppendixLabels } from '@/services/closeOut/closeOutArchive';
import { packPdfData } from '@/services/closeOutPdf/closeOutPackPdfData';
import {
  closeOutPackFilename,
  renderCloseOutPackPdf,
} from '@/services/closeOutPdf/renderCloseOutPack';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/sites/[id]/close-out/[packId]/pdf — the pack as a document.
 *
 * RENDERED ON DEMAND from live records, exactly as the pack PAGE is: `renderPack`
 * re-reads everything and re-checks permissions, so a pack opened by a different
 * person shows only what THEY may see. That is why there is no stored PDF to
 * serve — a frozen copy would quietly outlive somebody's access.
 *
 * The appendices are listed but their files are not attached: those live in the
 * ZIP, which is the deliverable that carries them.
 */
async function GETHandler(
  _req: NextRequest,
  { params }: { params: { id: string; packId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  const pack = await renderPack(viewer, params.packId);
  if (!pack || pack.siteId !== params.id) {
    return NextResponse.json({ ok: false, error: 'Pack not found.' }, { status: 404 });
  }

  const labels = await collectAppendixLabels(viewer, pack.siteId);
  const data = await packPdfData(pack, labels, { appendicesIncluded: false });
  const pdf = await renderCloseOutPackPdf(data);

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="${closeOutPackFilename(data)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export const GET = withClosedProjectHandling(GETHandler);
