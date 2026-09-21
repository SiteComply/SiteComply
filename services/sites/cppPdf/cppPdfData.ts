import path from 'path';
import { readFile } from 'fs/promises';
import { downloadDocumentBlob } from '@/services/documents/blobStorage';
import type { CppSnapshot } from '@/services/sites/cppRevisionService';

/**
 * Everything the Construction Phase Plan PDF needs, resolved before rendering.
 *
 * The renderer is deliberately given bytes rather than blob paths and plain
 * strings rather than Prisma rows: @react-pdf renders synchronously, so any I/O
 * left inside the component would either race the render or silently produce an
 * empty box where an image should be.
 */
export interface CppPdfData {
  site: CppSnapshot['site'];
  sections: CppSnapshot['sections'];
  drawings: CppSnapshot['drawings'];
  revision: {
    version: number;
    /** ISSUED or SUPERSEDED. A draft is never rendered — see renderCppPdf. */
    status: 'ISSUED' | 'SUPERSEDED';
    issuedAt: Date;
    issuedByName: string | null;
    preparedByName: string;
    preparedAt: Date;
    signedName: string | null;
    approverRole: string | null;
    declarationText: string | null;
    /** A drawn signature, already fetched. Null for TYPED or a missing blob. */
    signatureImage: Buffer | null;
    /** The later revision that replaced this one, when superseded. */
    supersededAt: Date | null;
  };
  /** The provenance mark. Read once, embedded in the document. */
  logo: Buffer | null;
}

/**
 * The SiteComply mark, from the same asset the screen document and the platform
 * Logo component use. A missing file must not fail the whole plan — the mark is
 * provenance, and a Construction Phase Plan without it is still the plan.
 */
async function readLogo(): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), 'public', 'sitecomply-logo.png'));
  } catch {
    return null;
  }
}

/**
 * Assemble the PDF's data from a frozen revision.
 *
 * THE SNAPSHOT IS THE SOURCE, not the live draft. That is the whole point of
 * rendering issued revisions only: what Revision 2 says is what was captured
 * when Revision 2 was issued, no matter what the site looks like today.
 */
export async function getCppPdfData(row: {
  version: number;
  status: string;
  issuedAt: Date | null;
  issuedByName: string | null;
  preparedByName: string;
  preparedAt: Date;
  signedName: string | null;
  approverRole: string | null;
  declarationText: string | null;
  signatureType: 'DRAWN' | 'TYPED' | null;
  signatureBlobPath: string | null;
  supersededAt: Date | null;
  snapshot: CppSnapshot;
}): Promise<CppPdfData | null> {
  if (row.status !== 'ISSUED' && row.status !== 'SUPERSEDED') return null;
  // An issued revision always has an issuedAt — but the type does not say so,
  // and a null here would silently render "Invalid Date" onto a controlled
  // document. Refuse instead.
  if (!row.issuedAt) return null;

  const [logo, signatureImage] = await Promise.all([
    readLogo(),
    // A missing or unreadable signature blob degrades to the typed name rather
    // than failing the document, the same rule the induction record follows.
    row.signatureType === 'DRAWN' && row.signatureBlobPath
      ? downloadDocumentBlob(row.signatureBlobPath).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    site: row.snapshot.site,
    sections: row.snapshot.sections,
    drawings: row.snapshot.drawings,
    revision: {
      version: row.version,
      status: row.status,
      issuedAt: row.issuedAt,
      issuedByName: row.issuedByName,
      preparedByName: row.preparedByName,
      preparedAt: row.preparedAt,
      signedName: row.signedName,
      approverRole: row.approverRole,
      declarationText: row.declarationText,
      signatureImage,
      supersededAt: row.supersededAt,
    },
    logo,
  };
}
