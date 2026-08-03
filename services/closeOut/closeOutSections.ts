import type { PlatformModule } from '@/services/platformUsers/platformPermissions';

/**
 * SC-024 — the close-out pack's section catalogue. DATA AND PURE HELPERS ONLY.
 *
 * Client-safe (no Prisma/server imports), mirroring dashboardPanels and
 * siteServiceCatalog, so the selection wizard, the counts and the rendered pack
 * all work from ONE definition of what a section is and what it draws on.
 *
 * EVERY SECTION NAMES THE MODULE IT READS. That is what lets the pack respect
 * the caller's effective permissions: a contractor narrowed out of Audits by
 * SC-022 must not be able to obtain audit reports by generating a pack instead.
 * A document that assembles records is exactly where an access control gets
 * quietly bypassed, so the module mapping is part of the catalogue rather than
 * an afterthought in the query layer.
 */

export type CloseOutSectionId =
  | 'PROJECT_INFORMATION'
  | 'CONSTRUCTION_PHASE_PLAN'
  | 'WORKER_RECORDS'
  | 'PERMITS'
  | 'INSPECTIONS_AUDITS'
  | 'ACTIONS'
  | 'PHOTOS_EVIDENCE'
  | 'DOCUMENTS'
  | 'ENVIRONMENTAL'
  | 'INCIDENTS';

export interface CloseOutSectionMeta {
  id: CloseOutSectionId;
  label: string;
  description: string;
  /** The module whose view permission governs this section's content. */
  module: PlatformModule;
  /** Icon key for the selection list. */
  icon: string;
  /** Included when a pack is first configured. */
  defaultSelected: boolean;
  /**
   * Rows shown per printed page, used for the page estimate. Rough by nature —
   * the estimate is labelled as one.
   */
  rowsPerPage: number;
  /**
   * Set when SiteComply has no data source for this section yet. Shown as
   * UNAVAILABLE rather than hidden: a handover pack that silently omits
   * incidents looks identical to a project that had none, and those are very
   * different statements to make to a client.
   */
  unavailableReason?: string;
}

export const CLOSE_OUT_SECTIONS: CloseOutSectionMeta[] = [
  {
    id: 'PROJECT_INFORMATION',
    label: 'Project Information',
    description: 'Project details, key contacts and project overview',
    module: 'sites',
    icon: 'info',
    defaultSelected: true,
    rowsPerPage: 20,
  },
  {
    id: 'CONSTRUCTION_PHASE_PLAN',
    label: 'Construction Phase Plan',
    description: 'The CPP assembled from the project setup (SC-019)',
    module: 'sites',
    icon: 'doc',
    defaultSelected: true,
    rowsPerPage: 12,
  },
  {
    id: 'WORKER_RECORDS',
    label: 'Worker Records',
    description: 'Attendance, competencies and worker inductions',
    module: 'checkins',
    icon: 'hardhat',
    defaultSelected: true,
    rowsPerPage: 30,
  },
  {
    id: 'PERMITS',
    label: 'Permits to Work',
    description: 'All permits issued during the project',
    module: 'permits',
    icon: 'permit',
    defaultSelected: true,
    rowsPerPage: 25,
  },
  {
    id: 'INSPECTIONS_AUDITS',
    label: 'Inspections & Audits',
    description: 'Inspection reports and audit results',
    module: 'audits',
    icon: 'clipboard',
    defaultSelected: true,
    rowsPerPage: 25,
  },
  {
    id: 'ACTIONS',
    label: 'Actions',
    description: 'Corrective actions and closure records',
    module: 'actions',
    icon: 'check',
    defaultSelected: true,
    rowsPerPage: 25,
  },
  {
    id: 'PHOTOS_EVIDENCE',
    label: 'Photos & Evidence',
    description: 'Site photos and supporting evidence',
    module: 'audits',
    icon: 'grid',
    defaultSelected: true,
    rowsPerPage: 6,
  },
  {
    id: 'DOCUMENTS',
    label: 'Documents',
    description: 'Key project documents and drawings',
    module: 'documents',
    icon: 'doc',
    defaultSelected: true,
    rowsPerPage: 30,
  },
  {
    id: 'ENVIRONMENTAL',
    label: 'Environmental Records',
    description: 'Environmental inspections recorded against this project',
    module: 'audits',
    icon: 'shield',
    // Off by default, matching the REV-1 example where Environmental Records is
    // the one unticked section.
    defaultSelected: false,
    rowsPerPage: 25,
  },
  {
    id: 'INCIDENTS',
    label: 'Incidents',
    description: 'Accident and incident reports',
    module: 'sites',
    icon: 'alert',
    defaultSelected: false,
    rowsPerPage: 25,
    unavailableReason:
      'SiteComply does not record incidents yet, so there is nothing to include. Add incident reports as a future item to complete this section.',
  },
];

export function sectionMeta(id: CloseOutSectionId): CloseOutSectionMeta {
  return CLOSE_OUT_SECTIONS.find((s) => s.id === id)!;
}

export function isCloseOutSection(v: unknown): v is CloseOutSectionId {
  return (
    typeof v === 'string' &&
    CLOSE_OUT_SECTIONS.some((s) => s.id === (v as CloseOutSectionId))
  );
}

/**
 * The photo ceiling for a Phase 1 pack.
 *
 * A print-to-PDF pack renders every included photo in the browser; several
 * hundred full-size images will stall the tab long before the paper runs out.
 * The pack states when it has capped rather than silently truncating, because
 * a handover document that quietly omits evidence is worse than one that says
 * it is partial.
 */
export const PHOTO_LIMIT = 250;

/** Pages a section will roughly occupy, minimum one when it is included. */
export function estimatePages(id: CloseOutSectionId, count: number): number {
  if (count <= 0) return 1;
  return Math.max(1, Math.ceil(count / sectionMeta(id).rowsPerPage));
}

/** The stored selection: which sections, in which order. */
export interface PackSectionChoice {
  section: CloseOutSectionId;
  order: number;
}

/** Normalise a stored or submitted selection into a clean, ordered list. */
export function normaliseSelection(raw: unknown): PackSectionChoice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PackSectionChoice[] = [];
  for (const entry of raw) {
    const section = (entry as { section?: unknown })?.section;
    if (!isCloseOutSection(section) || seen.has(section)) continue;
    // An unavailable section can never be part of a pack, however it was
    // submitted — the UI hides the option, and this makes it true regardless.
    if (sectionMeta(section).unavailableReason) continue;
    seen.add(section);
    out.push({ section, order: out.length });
  }
  return out;
}
