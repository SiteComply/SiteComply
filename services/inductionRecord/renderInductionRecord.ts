import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { InductionRecordPdf } from '@/services/inductionRecord/InductionRecordPdf';
import { registerDocumentFonts } from '@/services/pdfKit/documentKit';
import type { InductionRecordData } from '@/services/inductionRecord/inductionRecordData';

/**
 * Render the induction record to PDF bytes.
 *
 * The one place the document is turned into a file, so the worker route and the
 * Platform route cannot drift into producing different documents for the same
 * check-in — which would defeat the point of the thing being evidence.
 */
export async function renderInductionRecordPdf(
  data: InductionRecordData,
): Promise<Buffer> {
  registerDocumentFonts();
  // The cast is @react-pdf's typing, not a correctness question: renderToBuffer
  // is declared as taking a ReactElement<DocumentProps>, but a component that
  // RETURNS a <Document> does not satisfy that shape. The element rendered is a
  // Document either way.
  const element = React.createElement(InductionRecordPdf, { data });
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0]);
}

/**
 * The filename a reader ends up with in their downloads folder, and very likely
 * in a project file months later. It has to say what the document is without
 * being opened: who, which site, when.
 */
export function inductionRecordFilename(data: InductionRecordData): string {
  const safe = (v: string) =>
    v.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'record';
  const d = data.induction.completedAt;
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return `Induction-Record-${safe(data.operative.name)}-${safe(data.site.name)}-${date}.pdf`;
}
