import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { CppPdfDocument, registerFonts } from '@/services/sites/cppPdf/CppPdfDocument';
import type { CppPdfData } from '@/services/sites/cppPdf/cppPdfData';

/**
 * Render an issued Construction Phase Plan revision to PDF bytes.
 *
 * The one place the plan becomes a file, so nothing can drift into producing a
 * different document for the same revision — which would defeat the point of a
 * controlled document.
 *
 * DETERMINISTIC. The component pins the PDF's creation date to the revision's
 * issuedAt, so repeated renders of the same revision produce byte-identical
 * output. That is what makes rendering on demand equivalent to storing the file
 * and is asserted, not assumed, by cpp_pdf_verify.
 */
export async function renderCppPdf(data: CppPdfData): Promise<Buffer> {
  registerFonts();
  // The cast is @react-pdf's typing, not a correctness question: renderToBuffer
  // is declared as taking a ReactElement<DocumentProps>, which a component that
  // RETURNS a <Document> does not satisfy. The element rendered is a Document.
  const element = React.createElement(CppPdfDocument, { data });
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0]);
}

/**
 * Characters that cannot appear in a filename on Windows, plus the control
 * range. A UK site name legitimately contains apostrophes, ampersands, commas
 * and slashes — "St Mary's Wharf / Phase 2" — and a slash reaching a
 * Content-Disposition header is a path separator, not a character.
 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Tidy a name for use in a filename WITHOUT flattening it to hyphens.
 *
 * Accented and Welsh characters are kept — Ffôs-y-frân is the site's name, and
 * mangling it makes the file harder to identify, not safer. The route sends a
 * percent-encoded `filename*` alongside an ASCII fallback so both old and
 * modern clients get something sensible.
 */
function tidy(v: string): string {
  return v
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
}

/**
 * The filename a client, an auditor or a Principal Contractor ends up with.
 *
 *   CPP - 2417-DR - Dorchester Road - Rev 02.pdf
 *
 * Four facts in the order someone scans them: what the document is, which job,
 * which site, which revision. The hyphen-flattened, date-stamped earlier form
 * was unambiguous but unreadable in a folder listing or an email attachment
 * strip, which is where this name actually gets used.
 *
 * NO ISSUE DATE. The revision number is the document-control key, and the date
 * is on the document's own masthead and in the revisions register. Two
 * identifiers for one document invites the pair disagreeing.
 *
 * THE REVISION IS ZERO-PADDED, which is the one place this departs from the
 * shorter "Rev 2". Unpadded, a folder sorts Rev 10 between Rev 1 and Rev 2 —
 * exactly the confusion a controlled document must not create. Sites reaching
 * double-digit revisions are the ones where it matters most.
 */
export function cppRevisionFilename(data: CppPdfData): string {
  const ref = tidy(data.site.jobReference);
  const site = tidy(data.site.name) || 'Site';
  const rev = String(data.revision.version).padStart(2, '0');
  const parts = ['CPP', ref, site, `Rev ${rev}`].filter(Boolean);
  return `${parts.join(' - ')}.pdf`;
}

/**
 * The ASCII fallback for the `filename=` parameter, for clients that do not
 * understand RFC 5987's `filename*`. Accents are folded rather than dropped so
 * the name stays recognisable.
 */
export function asciiFilename(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'CPP.pdf';
}
