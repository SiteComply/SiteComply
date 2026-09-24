import { NextRequest, NextResponse } from 'next/server';
import { getWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { getWorkerPermit } from '@/services/permits/permitService';
import {
  loadPermitRecord,
  permitRecordFilename,
} from '@/services/permitRecord/permitRecordData';
import { renderPermitRecordPdf } from '@/services/permitRecord/renderPermitRecord';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/permits/[id]/record — the operative's own permit, as a PDF.
 *
 * OWNERSHIP FIRST, DOCUMENT SECOND. `getWorkerPermit` scopes by worker id, so a
 * permit belonging to somebody else is a 404 before anything is rendered.
 *
 * INLINE, not an attachment: this is opened on a phone at a work face and shown
 * to whoever asks. A download that lands in a Files app and has to be found
 * again is the wrong behaviour at a gate — the same choice the induction record
 * makes, for the same reason.
 */
async function GETHandler(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const context = await getWorkerContext();
  if (!context) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired.' },
      { status: 401 },
    );
  }
  const owned = await getWorkerPermit(context.worker.id, params.id);
  if (!owned) {
    return NextResponse.json({ ok: false, error: 'Permit not found.' }, { status: 404 });
  }

  const data = await loadPermitRecord(params.id);
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Permit not found.' }, { status: 404 });
  }
  const pdf = await renderPermitRecordPdf(data);
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `inline; filename="${permitRecordFilename(data)}"`,
      // A permit's state changes; a cached copy could say "authorised" after it
      // has expired.
      'Cache-Control': 'private, no-store',
    },
  });
}

export const GET = withClosedProjectHandling(GETHandler);
