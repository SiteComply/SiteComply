import { NextRequest, NextResponse } from 'next/server';
import { resolveShare } from '@/services/closeOut/closeOutSharing';
import { renderPack } from '@/services/closeOut/closeOutService';
import { collectAppendixLabels } from '@/services/closeOut/closeOutArchive';
import { packPdfData } from '@/services/closeOutPdf/closeOutPackPdfData';
import {
  closeOutPackFilename,
  renderCloseOutPackPdf,
} from '@/services/closeOutPdf/renderCloseOutPack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/pack/[token]/pdf — the pack a client was sent, as a document.
 *
 * No session: the token is the access, and the pack is rendered under the
 * SHARER'S CURRENT permissions (resolved live), so this cannot hand out
 * anything the person who shared it could not show today — the same rule the
 * share page and the ZIP already follow.
 *
 * This is the file a client keeps. It is the reason the pack stopped being an
 * HTML page they had to print themselves.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const resolved = await resolveShare(params.token);
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: 'This link is not valid.' }, { status: 404 });
  }
  const { share } = resolved;

  const pack = await renderPack(share.viewer, share.packId);
  if (!pack) {
    return NextResponse.json({ ok: false, error: 'Pack not found.' }, { status: 404 });
  }

  const labels = await collectAppendixLabels(share.viewer, pack.siteId);
  const data = await packPdfData(pack, labels, { appendicesIncluded: share.includeZip });
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
