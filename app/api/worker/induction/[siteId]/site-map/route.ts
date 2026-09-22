import { NextRequest, NextResponse } from 'next/server';
import { inductionReaderFor } from '@/services/induction/inductionAccess';
import { getSiteMapBlobForSite } from '@/services/sites/siteInformationService';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/induction/[siteId]/site-map
 *
 * The site map for the induction briefing, read BEFORE check-in. The dashboard
 * route (/api/worker/site-map) needs an open check-in, which an operative doing
 * their induction does not have yet. Access is the induction page's own test.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { siteId: string } },
) {
  if (!(await inductionReaderFor(params.siteId))) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  const map = await getSiteMapBlobForSite(params.siteId);
  const bytes = map ? await downloadDocumentBlob(map.blobPath) : null;
  if (!map || !bytes) {
    return NextResponse.json({ ok: false, error: 'No site map is available.' }, { status: 404 });
  }
  const safeName = map.fileName.replace(/["\r\n]/g, '_');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': map.mimeType || 'image/jpeg',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
