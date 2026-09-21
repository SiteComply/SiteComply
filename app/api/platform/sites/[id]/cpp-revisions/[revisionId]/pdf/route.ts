import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { getRevision } from '@/services/sites/cppRevisionService';
import { getCppPdfData } from '@/services/sites/cppPdf/cppPdfData';
import {
  renderCppPdf,
  cppRevisionFilename,
  asciiFilename,
} from '@/services/sites/cppPdf/renderCppPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/sites/[id]/cpp-revisions/[revisionId]/pdf
 *
 * The controlled artefact: an issued Construction Phase Plan revision as a
 * server-rendered PDF.
 *
 * WHY THIS EXISTS. The plan was previously produced with window.print(), which
 * stamps the browser's own header and footer — page title, URL, date, "1/7" —
 * onto a document that is issued to clients and read by CDM auditors. Those are
 * a setting in each user's print dialog, unreachable from CSS, and @page margin
 * boxes (the mechanism that would let a stylesheet own the running head) are not
 * implemented in Chrome. So the only way to control the output is to render it
 * here, where the running head, the running foot and the page numbers are ours
 * and are true.
 *
 * DRAFTS ARE NOT RENDERED. Rendering one would put a document that looks exactly
 * like a controlled plan into an email attachment without an approval or a
 * signature behind it. getCppPdfData refuses anything but ISSUED or SUPERSEDED,
 * and this route refuses before it gets there.
 *
 * A SUPERSEDED REVISION STILL RENDERS, deliberately: being able to produce what
 * was in force on a past date is the point of revision control. It renders with
 * its own status, so it cannot be mistaken for the current plan.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; revisionId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  // getRevision carries the authorisation: sites:view permission AND the site
  // being one this viewer can see. Re-deriving it here would be a second
  // opinion that could disagree with the screen the download sits on.
  const revision = await getRevision(viewer, params.id, params.revisionId);
  if (!revision) {
    return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  if (revision.status !== 'ISSUED' && revision.status !== 'SUPERSEDED') {
    return NextResponse.json(
      {
        ok: false,
        error:
          'A PDF is produced when a revision is issued. This revision is still a draft.',
      },
      { status: 409 },
    );
  }

  const data = await getCppPdfData(revision);
  if (!data) {
    return NextResponse.json(
      { ok: false, error: 'This revision cannot be rendered.' },
      { status: 409 },
    );
  }

  const pdf = await renderCppPdf(data);
  const filename = cppRevisionFilename(data);

  /*
   * BOTH FORMS OF THE FILENAME. `filename=` is a quoted ASCII string and cannot
   * carry the accented and Welsh characters that appear in real site names, so
   * a plan for Ffôs-y-frân would arrive mangled. RFC 5987's `filename*` carries
   * the true name percent-encoded as UTF-8; every current browser prefers it,
   * and anything that does not falls back to a folded-ASCII version that is
   * still recognisable rather than broken.
   */
  const fallback = asciiFilename(filename);
  const encoded = encodeURIComponent(filename);

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // `attachment` rather than `inline`: this is a document to be filed and
      // forwarded, and the filename is how it gets found again months later.
      'Content-Disposition':
        `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      'Content-Length': String(pdf.length),
      // The bytes are pinned to the revision's issue date and a snapshot that is
      // never updated, so this response is immutable for as long as the revision
      // exists. Private: it is a client's construction phase plan.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
