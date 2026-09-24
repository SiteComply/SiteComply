import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  PermitRecordPdf,
  registerFonts,
} from '@/services/permitRecord/PermitRecordPdf';
import type { PermitRecordData } from '@/services/permitRecord/permitRecordData';

/**
 * Render the permit to PDF bytes.
 *
 * The ONE place the document becomes a file, so the operative's copy and the
 * manager's copy of the same permit cannot drift into being different
 * documents — the same reason the induction record has a single renderer.
 */
export async function renderPermitRecordPdf(
  data: PermitRecordData,
): Promise<Buffer> {
  registerFonts();
  // The cast is @react-pdf's typing, not a correctness question: renderToBuffer
  // is declared as taking ReactElement<DocumentProps>, which a component that
  // RETURNS a <Document> does not satisfy. The element rendered is a Document.
  const element = React.createElement(PermitRecordPdf, { data });
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0]);
}
