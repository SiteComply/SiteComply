import { NextRequest, NextResponse } from 'next/server';
import { getWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { getSiteMapBlobForSite } from '@/services/sites/siteInformationService';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/site-map (SC-008)
 *
 * Streams the site-map image of the site the worker is CURRENTLY checked into.
 * The active site is re-derived server-side from the worker's open check-in
 * (never taken from the request), so a checked-out worker loses access
 * immediately. Blobs stay private; no public URL is ever issued.
 */
export async function GET(_req: NextRequest) {
  const context = await getWorkerContext();
  if (!context) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired.' },
      { status: 401 },
    );
  }

  const map = await getSiteMapBlobForSite(context.activeSiteId);
  if (!map) {
    return NextResponse.json(
      { ok: false, error: 'No site map is available.' },
      { status: 404 },
    );
  }

  const bytes = await downloadDocumentBlob(map.blobPath);
  if (!bytes) {
    return NextResponse.json(
      { ok: false, error: 'The site map is no longer available.' },
      { status: 404 },
    );
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
