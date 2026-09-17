import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { getInductionRecordData } from '@/services/inductionRecord/inductionRecordData';
import {
  renderInductionRecordPdf,
  inductionRecordFilename,
} from '@/services/inductionRecord/renderInductionRecord';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/inductions/[id]/record
 *
 * The operative's own signed induction record, as a PDF.
 *
 * Ownership is re-derived from the session and checked against the submission
 * before anything is rendered — the same rule the signature route uses. An
 * operative can produce their own records and nobody else's.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired.' },
      { status: 401 },
    );
  }
  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) {
    return NextResponse.json(
      { ok: false, error: 'Operative not found.' },
      { status: 401 },
    );
  }

  // Ownership first, and as its own query: rendering a document for someone
  // else's check-in and only then discovering it is not yours would mean the
  // bytes already exist.
  const owned = await prisma.submission.findFirst({
    where: { id: params.id, workerId: worker.id },
    select: { id: true },
  });
  if (!owned) {
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
      // INLINE, not attachment: the record is meant to be read before it is
      // kept. The browser's PDF viewer opens it, and the reader still has save
      // and print there — so nothing is lost, and a document nobody looked at
      // does not land in a downloads folder. The filename still travels with it
      // and is what the viewer's save button offers.
      'Content-Disposition': `inline; filename="${inductionRecordFilename(data)}"`,
      // Never cached: the document carries personal data and a generation
      // timestamp that must be true at the moment it is produced.
      'Cache-Control': 'private, no-store',
    },
  });
}
