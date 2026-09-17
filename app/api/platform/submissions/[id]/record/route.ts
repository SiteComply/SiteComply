import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getInductionRecordData } from '@/services/inductionRecord/inductionRecordData';
import {
  renderInductionRecordPdf,
  inductionRecordFilename,
} from '@/services/inductionRecord/renderInductionRecord';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/submissions/[id]/record
 *
 * The same induction record, produced by a Platform user.
 *
 * This route is the point of the work. Before it, only the operative could
 * produce the document — on their own phone, in their own session — which made a
 * "record suitable for clients and auditors" one that nobody who needs it could
 * obtain. A PM can now produce any in-scope operative's record without them
 * present.
 *
 * Gated on `checkins` view plus SITE SCOPE — the same module that gates the
 * Check-ins page this is downloaded from. The scope check matters more than
 * usual here: the document names an operative, their employer and their card
 * status, so a viewer restricted to one site must not be able to pull records
 * from another by guessing an id.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'checkins', 'view')) {
    return NextResponse.json(
      { ok: false, error: 'You cannot view check-in records.' },
      { status: 403 },
    );
  }

  // Site scope, resolved against the submission's own site. 404 rather than 403
  // for a site outside scope: its existence should not be confirmed.
  const inScope = await prisma.submission.findFirst({
    where: { id: params.id, jobSiteId: { in: viewer.siteIds } },
    select: { id: true },
  });
  if (!inScope) {
    return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  const data = await getInductionRecordData(params.id);
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  const pdf = await renderInductionRecordPdf(data);
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="${inductionRecordFilename(data)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
