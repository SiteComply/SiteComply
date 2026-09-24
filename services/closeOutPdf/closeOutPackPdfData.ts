import {
  getCompanyBranding,
  getCompanyLogo,
} from '@/services/company/companyConfigService';
import { readStoredNarrative } from '@/services/closeOut/closeOutAi';
import type { RenderedPack } from '@/services/closeOut/closeOutService';
import type { CloseOutPackPdfData } from '@/services/closeOutPdf/CloseOutPackPdf';

/**
 * Turn a rendered pack into the document's shape.
 *
 * A THIN ADAPTER ON PURPOSE. `renderPack` already decides what a pack contains,
 * which sections a viewer may see and how each one is laid out; re-deciding any
 * of that here would mean the PDF and the screen could disagree about the same
 * pack. This only adds the branding, attaches the machine-written prose to the
 * sections it belongs to, and lists the appendices.
 */
export async function packPdfData(
  pack: RenderedPack,
  appendices: { ref: string; title: string; source: string }[],
  opts: { appendicesIncluded?: boolean } = {},
): Promise<CloseOutPackPdfData> {
  const [branding, logo] = await Promise.all([
    getCompanyBranding(),
    getCompanyLogo(),
  ]);

  /*
   * The stored narrative is RE-VALIDATED against the sections this pack
   * actually has, exactly as the archive does. A narrative written for a
   * section that has since been removed must not surface here attached to
   * whatever now sits in its place.
   */
  const narrative = readStoredNarrative(
    pack.aiSummary,
    pack.sections.map((s) => s.id),
  );

  return {
    brand: {
      name: branding.companyName,
      tagline: branding.tagline ?? null,
      primaryColor: branding.primaryColor,
      logo,
    },
    title: pack.title,
    version: pack.version,
    preparedFor: pack.preparedFor,
    generatedByName: pack.generatedByName,
    generatedAt: pack.generatedAt,
    site: pack.site,
    sections: pack.sections.map((s) => ({
      id: s.id,
      label: s.label,
      facts: s.facts,
      rows: s.rows,
      photos: s.photos,
      cappedNote: s.cappedNote,
      narrative:
        narrative?.sectionNarratives.find((n) => n.sectionId === s.id)?.narrative ??
        null,
    })),
    executiveSummary: narrative?.executiveSummary ?? null,
    appendices,
    appendicesIncluded: opts.appendicesIncluded ?? false,
  };
}
