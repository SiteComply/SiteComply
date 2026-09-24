import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { registerDocumentFonts } from '@/services/pdfKit/documentKit';
import {
  CloseOutPackPdf,
  type CloseOutPackPdfData,
} from '@/services/closeOutPdf/CloseOutPackPdf';

/**
 * Render the close-out pack to PDF bytes.
 *
 * ONE renderer, used by the internal download, the client share link and the
 * ZIP. A handover pack that differed depending on which of the three produced
 * it would be indefensible.
 */
export async function renderCloseOutPackPdf(
  data: CloseOutPackPdfData,
): Promise<Buffer> {
  registerDocumentFonts();
  const element = React.createElement(CloseOutPackPdf, { data });
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0]);
}

/** What the recipient's downloads folder ends up holding. */
export function closeOutPackFilename(data: CloseOutPackPdfData): string {
  const safe = (v: string) =>
    v.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  return `Close-Out-Pack-${safe(data.site.name)}-v${data.version}.pdf`;
}
