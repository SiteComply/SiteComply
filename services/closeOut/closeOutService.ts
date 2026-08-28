import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { viewerCan } from '@/services/platformUsers/effectivePermissions';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import { manualCheckOutSummary } from '@/services/submissions/manualCheckOut';
import { supersededDocumentIds } from '@/services/documents/supersededDocuments';
import {
  CLOSE_OUT_SECTIONS,
  sectionMeta,
  estimatePages,
  normaliseSelection,
  PHOTO_LIMIT,
  type CloseOutSectionId,
  type PackSectionChoice,
} from '@/services/closeOut/closeOutSections';
import {
  supersededEvidenceIdsForSite,
  excludeIds,
} from '@/services/annotations/supersededEvidenceQuery';

/**
 * SC-024 Phase 1 — the project close-out pack.
 *
 * THE PACK IS NOT A BACK DOOR. Every section is gated on the caller's EFFECTIVE
 * permission for the module it reads — role narrowed by SC-022's per-site
 * overrides — so a contractor who cannot open Audits cannot obtain audit
 * reports by generating a pack instead. A document that assembles records from
 * across the platform is exactly where an access control gets quietly bypassed,
 * so the check happens in the same place the content is fetched.
 *
 * Counts are computed LIVE on every read. A stale count on a screen whose whole
 * purpose is to tell you what is in the pack would be worse than none.
 */

export function canGenerateCloseOutPack(role: PlatformRoleValue): boolean {
  return (
    role === 'DIRECTOR' || role === 'PROJECT_MANAGER' || role === 'SITE_MANAGER'
  );
}

export interface SectionAvailability {
  id: CloseOutSectionId;
  label: string;
  description: string;
  icon: string;
  defaultSelected: boolean;
  /** Live record count for this project, already permission-filtered. */
  count: number;
  /** What the count counts — "permits", "photos", … for the UI. */
  unit: string;
  estimatedPages: number;
  /** False when the viewer lacks the module, or no data source exists. */
  available: boolean;
  unavailableReason?: string;
}

const UNIT: Record<CloseOutSectionId, string> = {
  PROJECT_INFORMATION: 'pages',
  CONSTRUCTION_PHASE_PLAN: 'pages',
  WORKER_RECORDS: 'records',
  PERMITS: 'permits',
  INSPECTIONS_AUDITS: 'reports',
  ACTIONS: 'actions',
  PHOTOS_EVIDENCE: 'photos',
  DOCUMENTS: 'documents',
  ENVIRONMENTAL: 'records',
  INCIDENTS: 'incidents',
};

/** Live count for one section, or null when the viewer may not see it. */
async function countSection(
  viewer: PlatformViewer,
  siteId: string,
  id: CloseOutSectionId,
): Promise<number | null> {
  const meta = sectionMeta(id);
  if (meta.unavailableReason) return null;
  // SC-022 — effective permission for THIS site, not the role baseline.
  if (!viewerCan(viewer, meta.module, 'view', siteId)) return null;

  switch (id) {
    case 'PROJECT_INFORMATION':
      return 1;
    case 'CONSTRUCTION_PHASE_PLAN':
      return 1;
    case 'WORKER_RECORDS':
      return prisma.submission.count({ where: { jobSiteId: siteId } });
    case 'PERMITS':
      return prisma.permit.count({ where: { jobSiteId: siteId } });
    case 'INSPECTIONS_AUDITS':
      return prisma.audit.count({ where: { jobSiteId: siteId } });
    case 'ACTIONS':
      return prisma.action.count({ where: { jobSiteId: siteId } });
    case 'PHOTOS_EVIDENCE': {
      // Evidence hangs off audit findings and actions, so both are counted.
      // SC-017 FOLLOW-UP: the original an annotated photo was made from is NOT
      // counted. It is one piece of evidence, and counting it twice overstated
      // the pack before anyone opened it.
      const superseded = await supersededEvidenceIdsForSite(siteId);
      const [findings, actions] = await Promise.all([
        prisma.findingEvidence.count({
          where: {
            finding: { audit: { jobSiteId: siteId } },
            id: excludeIds(superseded.findingEvidenceIds),
          },
        }),
        prisma.actionEvidence.count({
          where: {
            action: { jobSiteId: siteId },
            id: excludeIds(superseded.actionEvidenceIds),
          },
        }),
      ]);
      return findings + actions;
    }
    case 'DOCUMENTS': {
      // One document, not two: an original superseded by a surviving annotated
      // copy is not counted, matching the Documents register. The photo
      // sections above already apply the equivalent evidence rule; this branch
      // was simply never given it.
      const supersededDocs = await supersededDocumentIds([siteId]);
      return prisma.document.count({
        where: {
          jobSiteId: siteId,
          id: supersededDocs.length > 0 ? { notIn: supersededDocs } : undefined,
        },
      });
    }
    case 'ENVIRONMENTAL':
      // Environmental records are audits built from the SC-021 Environmental
      // Inspection template — there is no separate store, and pretending
      // otherwise would invent a category the platform does not have.
      return prisma.audit.count({
        where: {
          jobSiteId: siteId,
          sourceTemplateName: { contains: 'Environmental' },
        },
      });
    default:
      return null;
  }
}

/** Every section with its live count and availability, for the wizard. */
export async function getSectionAvailability(
  viewer: PlatformViewer,
  siteId: string,
): Promise<SectionAvailability[] | null> {
  if (!viewer.siteIds.includes(siteId)) return null;

  const rows: SectionAvailability[] = [];
  for (const meta of CLOSE_OUT_SECTIONS) {
    const count = await countSection(viewer, siteId, meta.id);
    const permitted =
      !meta.unavailableReason && viewerCan(viewer, meta.module, 'view', siteId);
    rows.push({
      id: meta.id,
      label: meta.label,
      description: meta.description,
      icon: meta.icon,
      defaultSelected: meta.defaultSelected && count !== null,
      count: count ?? 0,
      unit: UNIT[meta.id],
      estimatedPages: count === null ? 0 : estimatePages(meta.id, count),
      available: count !== null,
      unavailableReason: meta.unavailableReason
        ? meta.unavailableReason
        : permitted
          ? undefined
          : 'You do not have access to this information on this project, so it cannot be included.',
    });
  }
  return rows;
}

export interface PackSummary {
  id: string;
  version: number;
  title: string;
  generatedByName: string;
  generatedAt: Date;
  sectionCount: number;
  preparedFor: string | null;
  /** SC-024 Phase 2 — the stored ZIP artefact, if one has been built. */
  zip: {
    generatedAt: Date;
    sizeBytes: number;
    fileCount: number;
    truncated: boolean;
  } | null;
}

/** Revision history for a project, newest first. */
export async function listPacks(
  viewer: PlatformViewer,
  siteId: string,
): Promise<PackSummary[] | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const rows = await prisma.closeOutPack.findMany({
    where: { jobSiteId: siteId },
    orderBy: { version: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    title: r.title,
    generatedByName: r.generatedByName,
    generatedAt: r.generatedAt,
    sectionCount: normaliseSelection(r.sections).length,
    preparedFor: r.preparedFor,
    zip:
      r.zipBlobPath && r.zipGeneratedAt
        ? {
            generatedAt: r.zipGeneratedAt,
            sizeBytes: r.zipSizeBytes ?? 0,
            fileCount: r.zipFileCount ?? 0,
            truncated: r.zipTruncated,
          }
        : null,
  }));
}

export type CreatePackResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/**
 * Generate a pack.
 *
 * The selection is re-validated server-side: unavailable sections and sections
 * the caller cannot see are dropped rather than trusted from the form, so a
 * crafted request cannot widen what a pack contains.
 *
 * The version number is derived from the existing rows, and the unique index on
 * (site, version) is what actually guarantees it — two people generating at once
 * cannot both claim version 3.
 */
export async function createPack(
  viewer: PlatformViewer,
  siteId: string,
  input: { title?: string; preparedFor?: string; sections: unknown },
): Promise<CreatePackResult> {
  if (!canGenerateCloseOutPack(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true, name: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const requested = normaliseSelection(input.sections);
  // Drop anything the caller cannot actually see. Silently including it would
  // be the bypass this whole design exists to prevent.
  const permitted: PackSectionChoice[] = [];
  for (const choice of requested) {
    const meta = sectionMeta(choice.section);
    if (viewerCan(viewer, meta.module, 'view', siteId)) {
      permitted.push({ section: choice.section, order: permitted.length });
    }
  }
  if (permitted.length === 0) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Choose at least one section to include.',
    };
  }

  const last = await prisma.closeOutPack.findFirst({
    where: { jobSiteId: siteId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  const created = await prisma.closeOutPack.create({
    data: {
      jobSiteId: siteId,
      version,
      title:
        (input.title ?? '').trim() || `${site.name} — Project Close-Out Pack`,
      preparedFor: (input.preparedFor ?? '').trim() || null,
      sections: permitted as unknown as object,
      generatedByUserId: viewer.id,
      generatedByName: viewer.name,
    },
    select: { id: true, version: true },
  });
  return { ok: true, id: created.id, version: created.version };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

export interface RenderedSection {
  id: CloseOutSectionId;
  label: string;
  /** Rows for tabular sections. */
  rows?: { label: string; value: string }[][];
  /** Simple key/value blocks for narrative sections. */
  facts?: { label: string; value: string }[];
  photos?: { id: string; caption: string }[];
  count: number;
  /** Set when the section was capped, so the pack can say so. */
  cappedNote?: string;
}

export interface RenderedPack {
  id: string;
  /** The project this pack belongs to — needed to collect its appendices. */
  siteId: string;
  version: number;
  title: string;
  preparedFor: string | null;
  generatedByName: string;
  generatedAt: Date;
  site: {
    name: string;
    jobReference: string;
    address: string;
  };
  sections: RenderedSection[];
  estimatedPages: number;
  photoCount: number;
  /** SC-024 Phase 3 — the stored AI narrative (raw JSON) and its provenance. */
  aiSummary: string | null;
  aiModel: string | null;
  aiGeneratedAt: Date | null;
  aiGeneratedBy: string | null;
}

/**
 * Build the pack's content for display or printing.
 *
 * Re-reads live records and RE-CHECKS permissions, because a pack generated
 * last month by someone else must not expose sections to a viewer who cannot
 * see them now. The stored selection decides the ORDER; the viewer decides
 * what they are actually shown.
 */
export async function renderPack(
  viewer: PlatformViewer,
  packId: string,
): Promise<RenderedPack | null> {
  const pack = await prisma.closeOutPack.findUnique({
    where: { id: packId },
    include: {
      jobSite: {
        select: {
          id: true,
          name: true,
          jobReference: true,
          addressLine1: true,
          addressLine2: true,
          town: true,
          postcode: true,
        },
      },
    },
  });
  if (!pack) return null;
  if (!viewer.siteIds.includes(pack.jobSiteId)) return null;

  const siteId = pack.jobSiteId;
  const chosen = normaliseSelection(pack.sections);
  const sections: RenderedSection[] = [];
  let photoCount = 0;
  let pages = 1; // the cover

  for (const choice of chosen) {
    const meta = sectionMeta(choice.section);
    if (!viewerCan(viewer, meta.module, 'view', siteId)) continue;
    const rendered = await renderSection(choice.section, siteId);
    if (!rendered) continue;
    if (rendered.photos) photoCount += rendered.photos.length;
    pages += estimatePages(choice.section, rendered.count);
    sections.push(rendered);
  }

  const s = pack.jobSite;
  return {
    id: pack.id,
    siteId: pack.jobSiteId,
    version: pack.version,
    title: pack.title,
    preparedFor: pack.preparedFor,
    generatedByName: pack.generatedByName,
    generatedAt: pack.generatedAt,
    site: {
      name: s.name,
      jobReference: s.jobReference,
      address: [s.addressLine1, s.addressLine2, s.town, s.postcode]
        .filter(Boolean)
        .join(', '),
    },
    sections,
    estimatedPages: pages,
    photoCount,
    aiSummary: pack.aiSummary,
    aiModel: pack.aiModel,
    aiGeneratedAt: pack.aiGeneratedAt,
    aiGeneratedBy: pack.aiGeneratedBy,
  };
}

const fmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB') : '—';

async function renderSection(
  id: CloseOutSectionId,
  siteId: string,
): Promise<RenderedSection | null> {
  const meta = sectionMeta(id);
  const base = { id, label: meta.label };

  switch (id) {
    case 'PROJECT_INFORMATION': {
      const [site, info, cdm] = await Promise.all([
        prisma.jobSite.findUnique({
          where: { id: siteId },
          select: {
            name: true,
            jobReference: true,
            status: true,
            fireAssemblyPoint: true,
            nearestHospital: true,
            emergencyNumber: true,
          },
        }),
        prisma.siteInformation.findUnique({
          where: { jobSiteId: siteId },
          select: { workingHours: true, welfareFacilities: true },
        }),
        prisma.cdmDutyHolders.findUnique({
          where: { jobSiteId: siteId },
          select: {
            clientName: true,
            principalContractor: true,
            principalDesigner: true,
          },
        }),
      ]);
      const facts = [
        { label: 'Project', value: site?.name ?? '—' },
        { label: 'Job reference', value: site?.jobReference ?? '—' },
        { label: 'Status', value: site?.status ?? '—' },
        { label: 'Client', value: cdm?.clientName ?? 'Not recorded' },
        {
          label: 'Principal Contractor',
          value: cdm?.principalContractor ?? 'Not recorded',
        },
        {
          label: 'Principal Designer',
          value: cdm?.principalDesigner ?? 'Not recorded',
        },
        { label: 'Working hours', value: info?.workingHours ?? 'Not recorded' },
        {
          label: 'Welfare facilities',
          value: info?.welfareFacilities ?? 'Not recorded',
        },
        {
          label: 'Fire assembly point',
          value: site?.fireAssemblyPoint ?? 'Not recorded',
        },
        {
          label: 'Nearest hospital',
          value: site?.nearestHospital ?? 'Not recorded',
        },
        {
          label: 'Emergency number',
          value: site?.emergencyNumber ?? 'Not recorded',
        },
      ];
      return { ...base, facts, count: facts.length };
    }

    case 'CONSTRUCTION_PHASE_PLAN': {
      const [project, info] = await Promise.all([
        prisma.siteProjectDetails.findUnique({
          where: { jobSiteId: siteId },
          select: {
            description: true,
            scopeOfWorks: true,
            startDate: true,
            plannedEndDate: true,
            cdmNotifiable: true,
            f10Reference: true,
          },
        }),
        prisma.siteInformation.findUnique({
          where: { jobSiteId: siteId },
          select: {
            siteRules: true,
            siteHazards: true,
            emergencyProcedures: true,
          },
        }),
      ]);
      const facts = [
        { label: 'Description', value: project?.description ?? 'Not recorded' },
        {
          label: 'Scope of works',
          value: project?.scopeOfWorks ?? 'Not recorded',
        },
        { label: 'Start date', value: fmt(project?.startDate) },
        { label: 'Planned completion', value: fmt(project?.plannedEndDate) },
        {
          label: 'CDM notifiable',
          value: project?.cdmNotifiable ? 'Yes' : 'No',
        },
        {
          label: 'F10 reference',
          value: project?.f10Reference ?? 'Not recorded',
        },
        { label: 'Site rules', value: info?.siteRules ?? 'Not recorded' },
        { label: 'Hazards', value: info?.siteHazards ?? 'Not recorded' },
        {
          label: 'Emergency procedures',
          value: info?.emergencyProcedures ?? 'Not recorded',
        },
      ];
      return { ...base, facts, count: facts.length };
    }

    case 'WORKER_RECORDS': {
      const rows = await prisma.submission.findMany({
        where: { jobSiteId: siteId },
        orderBy: { checkedInAt: 'desc' },
        take: 500,
        include: {
          worker: {
            select: { fullName: true, company: true, cscsCardNumber: true },
          },
        },
      });
      return {
        ...base,
        count: rows.length,
        rows: rows.map((r) => [
          { label: 'Worker', value: r.worker.fullName },
          { label: 'Company', value: r.worker.company },
          { label: 'CSCS', value: r.worker.cscsCardNumber ?? '—' },
          { label: 'Checked in', value: fmt(r.checkedInAt) },
          // BL-001 — the pack is the handover record. A departure reconstructed
          // by a manager is shown as exactly that, with who did it and why, so
          // the pack cannot present it as the worker's own check-out.
          {
            label: 'Checked out',
            value: r.checkedOutManual
              ? `${fmt(r.checkedOutAt)} — manual, ${manualCheckOutSummary(r)}`
              : fmt(r.checkedOutAt),
          },
        ]),
      };
    }

    case 'PERMITS': {
      const rows = await prisma.permit.findMany({
        where: { jobSiteId: siteId },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return {
        ...base,
        count: rows.length,
        rows: rows.map((r) => [
          { label: 'Reference', value: r.reference },
          { label: 'Type', value: r.permitTypeName },
          { label: 'Requested by', value: r.submittedByName },
          { label: 'Status', value: r.status },
          { label: 'Raised', value: fmt(r.createdAt) },
        ]),
      };
    }

    case 'INSPECTIONS_AUDITS':
    case 'ENVIRONMENTAL': {
      const rows = await prisma.audit.findMany({
        where: {
          jobSiteId: siteId,
          ...(id === 'ENVIRONMENTAL'
            ? { sourceTemplateName: { contains: 'Environmental' } }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: { _count: { select: { findings: true } } },
      });
      return {
        ...base,
        count: rows.length,
        rows: rows.map((r) => [
          { label: 'Title', value: r.title },
          { label: 'Type', value: r.sourceTemplateName ?? 'Ad hoc' },
          { label: 'Status', value: r.status },
          {
            label: 'Score',
            value:
              r.calculatedPercent !== null ? `${r.calculatedPercent}%` : '—',
          },
          { label: 'Findings', value: String(r._count.findings) },
          { label: 'Date', value: fmt(r.createdAt) },
        ]),
      };
    }

    case 'ACTIONS': {
      const rows = await prisma.action.findMany({
        where: { jobSiteId: siteId },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return {
        ...base,
        count: rows.length,
        rows: rows.map((r) => [
          { label: 'Title', value: r.title },
          { label: 'Assigned to', value: r.assignedTo ?? '—' },
          { label: 'Priority', value: r.priority },
          { label: 'Status', value: r.status },
          { label: 'Due', value: fmt(r.dueDate) },
        ]),
      };
    }

    case 'PHOTOS_EVIDENCE': {
      // SC-017 FOLLOW-UP: superseded originals are excluded IN THE QUERY, not
      // afterwards — the take below caps the result, so filtering later would
      // let them use up slots and then disappear, silently shrinking the pack.
      const superseded = await supersededEvidenceIdsForSite(siteId);
      const [findings, actions] = await Promise.all([
        prisma.findingEvidence.findMany({
          where: {
            finding: { audit: { jobSiteId: siteId } },
            id: excludeIds(superseded.findingEvidenceIds),
          },
          orderBy: { createdAt: 'desc' },
          take: PHOTO_LIMIT,
          select: { id: true, fileName: true, createdAt: true },
        }),
        prisma.actionEvidence.findMany({
          where: {
            action: { jobSiteId: siteId },
            id: excludeIds(superseded.actionEvidenceIds),
          },
          orderBy: { createdAt: 'desc' },
          take: PHOTO_LIMIT,
          select: { id: true, fileName: true, createdAt: true },
        }),
      ]);
      const all = [...findings, ...actions].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      const capped = all.length > PHOTO_LIMIT;
      const photos = all.slice(0, PHOTO_LIMIT).map((p) => ({
        id: p.id,
        caption: `${p.fileName} · ${fmt(p.createdAt)}`,
      }));
      return {
        ...base,
        count: photos.length,
        photos,
        // Stated, never silent: a handover pack that quietly drops evidence is
        // worse than one that says it is partial.
        cappedNote: capped
          ? `Showing the most recent ${PHOTO_LIMIT} of ${all.length} items. The remainder are available in the Audits and Actions records.`
          : undefined,
      };
    }

    case 'DOCUMENTS': {
      // Excluded in the QUERY, not after it: the section is capped at 500, so
      // superseded rows filtered later would consume slots and then vanish,
      // quietly shortening the pack.
      const supersededDocs = await supersededDocumentIds([siteId]);
      const rows = await prisma.document.findMany({
        where: {
          jobSiteId: siteId,
          id: supersededDocs.length > 0 ? { notIn: supersededDocs } : undefined,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return {
        ...base,
        count: rows.length,
        rows: rows.map((r) => [
          { label: 'Title', value: r.title },
          { label: 'Category', value: r.category },
          { label: 'File', value: r.fileName },
          { label: 'Expires', value: fmt(r.expiresAt) },
          { label: 'Uploaded', value: fmt(r.createdAt) },
        ]),
      };
    }

    default:
      return null;
  }
}
