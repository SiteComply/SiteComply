import { NextRequest, NextResponse } from 'next/server';
import { DocumentCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inductionReaderFor } from '@/services/induction/inductionAccess';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';
import { documentCompanyWhere } from '@/services/documents/documentVisibility';
import { companyForAssignment } from '@/services/companies/siteCompanyService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/induction/[siteId]/documents/[documentId]
 *
 * A RAMS document linked from the induction briefing, read BEFORE check-in.
 *
 * NARROWER than the dashboard's document route on purpose: RAMS only, and only
 * this site's. The briefing links nothing else, so nothing else is served here.
 * Access is the induction page's own test; anything outside it is not found.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { siteId: string; documentId: string } },
) {
  const reader = await inductionReaderFor(params.siteId);
  if (!reader) {
    return NextResponse.json({ ok: false, error: 'Document not found.' }, { status: 404 });
  }

  /*
   * THE SAME RULE THE LIST APPLIES, applied again here.
   *
   * The briefing only ever links this operative's own RAMS, but "not linked" is
   * not "not reachable": a document id in a URL would otherwise fetch another
   * contractor's method statement. Listing and retrieving must agree, or the
   * protection is only as good as nobody trying.
   */
  const company = await companyForAssignment(reader.workerId, params.siteId);
  const doc = await prisma.document.findFirst({
    where: {
      id: params.documentId,
      jobSiteId: params.siteId,
      category: DocumentCategory.RAMS,
      ...documentCompanyWhere(company?.id ?? null),
    },
    select: { blobPath: true, fileName: true, mimeType: true },
  });
  const bytes = doc ? await downloadDocumentBlob(doc.blobPath) : null;
  if (!doc || !bytes) {
    return NextResponse.json({ ok: false, error: 'Document not found.' }, { status: 404 });
  }
  const safeName = doc.fileName.replace(/["\r\n]/g, '_');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': doc.mimeType || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
