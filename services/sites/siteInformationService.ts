import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  buildBlobPath,
  uploadDocumentBlob,
  deleteDocumentBlob,
} from '@/services/documents/blobStorage';
import {
  WORKING_HOURS_MAX,
  SITE_TEXT_MAX,
  SITE_MAP_MAX_BYTES,
  SITE_MAP_MIME_TYPES,
  SITE_INFO_SECTIONS,
  SITE_EMERGENCY_SECTIONS,
} from '@/services/sites/siteInformationConstants';

/**
 * Site Information (SC-008) — the structured, worker-facing content a Site
 * Manager maintains for a site: working hours, site rules, welfare facilities,
 * site-specific hazards, emergency procedures and a site-map image.
 *
 * Managed by any role holding the `sites` "edit" permission for a site in scope
 * (site managers included — day-to-day site content, unlike the Director-only
 * site record). The site boundary is re-checked here as defence in depth; routes
 * check the same permission before calling. Emergency fields (fire assembly,
 * first aider, A&E, emergency number) stay on the JobSite record and are only
 * surfaced read-only — this service never writes them.
 */

const EMPTY = {
  workingHours: null,
  siteRules: null,
  welfareFacilities: null,
  siteHazards: null,
  emergencyProcedures: null,
  siteMapBlobPath: null,
  siteMapFileName: null,
  siteMapMimeType: null,
  siteMapSizeBytes: null,
} as const;

export interface SiteInformationFields {
  workingHours: string | null;
  siteRules: string | null;
  welfareFacilities: string | null;
  siteHazards: string | null;
  emergencyProcedures: string | null;
  hasSiteMap: boolean;
  siteMapFileName: string | null;
  updatedByName: string | null;
  updatedAt: Date | null;
}

export interface SiteInfoCompleteness {
  complete: number;
  total: number;
  /** Section labels still empty, for the "what's missing" hint. */
  missing: string[];
}

export type SaveResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'validation';
      errors?: Record<string, string>;
    };

export type MapResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'validation';
      error?: string;
    };

/** Read the raw record (or the empty shape) for a site. */
async function readRecord(siteId: string) {
  const row = await prisma.siteInformation.findUnique({
    where: { jobSiteId: siteId },
  });
  return row;
}

function toFields(
  row: Awaited<ReturnType<typeof readRecord>>,
): SiteInformationFields {
  return {
    workingHours: row?.workingHours ?? null,
    siteRules: row?.siteRules ?? null,
    welfareFacilities: row?.welfareFacilities ?? null,
    siteHazards: row?.siteHazards ?? null,
    emergencyProcedures: row?.emergencyProcedures ?? null,
    hasSiteMap: Boolean(row?.siteMapBlobPath),
    siteMapFileName: row?.siteMapFileName ?? null,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Which of the manager-owned sections are populated (for the indicator). */
export function computeCompleteness(
  fields: SiteInformationFields,
): SiteInfoCompleteness {
  const filled: Record<string, boolean> = {
    workingHours: Boolean(fields.workingHours?.trim()),
    siteRules: Boolean(fields.siteRules?.trim()),
    welfareFacilities: Boolean(fields.welfareFacilities?.trim()),
    siteHazards: Boolean(fields.siteHazards?.trim()),
    emergencyProcedures: Boolean(fields.emergencyProcedures?.trim()),
    siteMap: fields.hasSiteMap,
  };
  const missing = SITE_INFO_SECTIONS.filter((s) => !filled[s.key]).map(
    (s) => s.label,
  );
  return {
    complete: SITE_INFO_SECTIONS.length - missing.length,
    total: SITE_INFO_SECTIONS.length,
    missing,
  };
}

/** The emergency values as stored on the site record. */
export interface SiteEmergencyFields {
  fireAssemblyPoint: string | null;
  firstAiderName: string | null;
  firstAiderNumber: string | null;
  firstAiderLocation: string | null;
  nearestHospital: string | null;
  emergencyNumber: string | null;
}

/** Which emergency sections are populated. */
export function computeEmergencyCompleteness(
  e: SiteEmergencyFields,
): SiteInfoCompleteness {
  const filled: Record<string, boolean> = {
    fireAssemblyPoint: Boolean(e.fireAssemblyPoint?.trim()),
    // Name only — matches the worker page, which keys the whole first-aider
    // block off the name and treats location and number as optional detail.
    firstAider: Boolean(e.firstAiderName?.trim()),
    nearestHospital: Boolean(e.nearestHospital?.trim()),
    emergencyNumber: Boolean(e.emergencyNumber?.trim()),
  };
  const missing = SITE_EMERGENCY_SECTIONS.filter((s) => !filled[s.key]).map(
    (s) => s.label,
  );
  return {
    complete: SITE_EMERGENCY_SECTIONS.length - missing.length,
    total: SITE_EMERGENCY_SECTIONS.length,
    missing,
  };
}

/**
 * Everything a worker can see about a site, as one figure — the Site Information
 * sections PLUS the emergency sections.
 *
 * Kept separate from computeCompleteness() rather than folded into it, because
 * the two are read in different places and each has to be honest about what it
 * measures. The Site Information panel shows its OWN six sections; widening that
 * number would misreport the panel the manager is looking at. The site Overview
 * shows this one, under a label that promises what workers see — and the
 * Emergency page is worker-facing, so it belongs in the total.
 */
export function computeWorkerFacingCompleteness(
  fields: SiteInformationFields,
  emergency: SiteEmergencyFields,
): SiteInfoCompleteness {
  const info = computeCompleteness(fields);
  const emerg = computeEmergencyCompleteness(emergency);
  return {
    complete: info.complete + emerg.complete,
    total: info.total + emerg.total,
    missing: [...info.missing, ...emerg.missing],
  };
}

// ─── Admin (site-manager) reads/writes ──────────────────────────────────────

export interface SiteInformationForViewer {
  fields: SiteInformationFields;
  /** The Site Information panel's own six sections. */
  completeness: SiteInfoCompleteness;
  /**
   * Site Information + emergency, i.e. everything a worker can see. This is what
   * the site Overview reports, so the figure there matches the worker's reality.
   */
  workerFacingCompleteness: SiteInfoCompleteness;
  /** Emergency completeness on its own, for the emergency panel's own indicator. */
  emergencyCompleteness: SiteInfoCompleteness;
  /**
   * Emergency values, stored on the site record. Editable by any role holding the
   * `sites` edit permission — the same gate as the rest of this panel — via
   * saveSiteEmergency(). Site identity and status stay Director-only.
   */
  emergency: SiteEmergencyFields;
}

export async function getSiteInformationForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<SiteInformationForViewer | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const [row, site] = await Promise.all([
    readRecord(siteId),
    prisma.jobSite.findUnique({
      where: { id: siteId },
      select: {
        fireAssemblyPoint: true,
        firstAiderName: true,
        firstAiderNumber: true,
        firstAiderLocation: true,
        nearestHospital: true,
        emergencyNumber: true,
      },
    }),
  ]);
  if (!site) return null;
  const fields = toFields(row);
  return {
    fields,
    completeness: computeCompleteness(fields),
    workerFacingCompleteness: computeWorkerFacingCompleteness(fields, site),
    emergencyCompleteness: computeEmergencyCompleteness(site),
    emergency: site,
  };
}

export interface SiteEmergencyInput {
  fireAssemblyPoint?: string;
  firstAiderName?: string;
  firstAiderNumber?: string;
  firstAiderLocation?: string;
  nearestHospital?: string;
  emergencyNumber?: string;
}

/**
 * Save the emergency information a worker sees, from the Worker Experience tab.
 *
 * Gated on the SAME `sites` edit permission as the rest of that tab, so the
 * roles the RBAC matrix puts in charge of running a site can maintain the first
 * aider, nearest A&E, fire assembly point and emergency number. These fields
 * previously reached the database only through the whole-site form, which is
 * Director-only — so a Site Manager could see that the information was missing
 * and had no way to add it.
 *
 * SITE_EDIT_ROLES is deliberately NOT used and NOT widened: site name, address,
 * job reference, status, archive and reactivate stay Director-only. The write
 * below whitelists six columns, so the wider site payload cannot ride along on
 * this endpoint.
 */
export async function saveSiteEmergency(
  viewer: PlatformViewer,
  siteId: string,
  input: SiteEmergencyInput,
): Promise<SaveResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  // Site scope is the access boundary, exactly as saveSiteInformation applies it.
  if (!viewer.siteIds.includes(siteId)) {
    return { ok: false, reason: 'forbidden' };
  }

  await prisma.jobSite.update({
    where: { id: siteId },
    data: {
      fireAssemblyPoint: clean(input.fireAssemblyPoint, SITE_TEXT_MAX),
      firstAiderName: clean(input.firstAiderName, SITE_TEXT_MAX),
      firstAiderNumber: clean(input.firstAiderNumber, SITE_TEXT_MAX),
      firstAiderLocation: clean(input.firstAiderLocation, SITE_TEXT_MAX),
      nearestHospital: clean(input.nearestHospital, SITE_TEXT_MAX),
      emergencyNumber: clean(input.emergencyNumber, SITE_TEXT_MAX),
    },
  });
  return { ok: true };
}

export interface SiteInformationInput {
  workingHours?: string;
  siteRules?: string;
  welfareFacilities?: string;
  siteHazards?: string;
  emergencyProcedures?: string;
}

function clean(value: string | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

export async function saveSiteInformation(
  viewer: PlatformViewer,
  siteId: string,
  input: SiteInformationInput,
): Promise<SaveResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const data = {
    workingHours: clean(input.workingHours, WORKING_HOURS_MAX),
    siteRules: clean(input.siteRules, SITE_TEXT_MAX),
    welfareFacilities: clean(input.welfareFacilities, SITE_TEXT_MAX),
    siteHazards: clean(input.siteHazards, SITE_TEXT_MAX),
    emergencyProcedures: clean(input.emergencyProcedures, SITE_TEXT_MAX),
    updatedByUserId: viewer.id,
    updatedByName: viewer.name,
  };

  await prisma.siteInformation.upsert({
    where: { jobSiteId: siteId },
    create: { jobSiteId: siteId, ...data },
    update: data,
  });
  return { ok: true };
}

// ─── Site map (reuses the Documents module's private Azure Blob storage) ─────

export async function setSiteMap(
  viewer: PlatformViewer,
  siteId: string,
  file: { buffer: Buffer; fileName: string; mimeType: string; size: number },
): Promise<MapResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  if (!(SITE_MAP_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    return {
      ok: false,
      reason: 'validation',
      error: 'The site map must be a JPG, PNG or WebP image.',
    };
  }
  if (file.size <= 0 || file.size > SITE_MAP_MAX_BYTES) {
    return {
      ok: false,
      reason: 'validation',
      error: 'The site map must be a non-empty image up to 20 MB.',
    };
  }

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const previous = await readRecord(siteId);
  const blobPath = buildBlobPath(siteId, file.fileName || 'site-map');
  await uploadDocumentBlob(blobPath, file.buffer, file.mimeType);

  try {
    const data = {
      siteMapBlobPath: blobPath,
      siteMapFileName: file.fileName || 'site-map',
      siteMapMimeType: file.mimeType,
      siteMapSizeBytes: file.size,
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
    };
    await prisma.siteInformation.upsert({
      where: { jobSiteId: siteId },
      create: { jobSiteId: siteId, ...EMPTY, ...data },
      update: data,
    });
  } catch (error) {
    await deleteDocumentBlob(blobPath); // roll back the orphaned blob
    throw error;
  }

  // Best-effort removal of the replaced blob.
  if (previous?.siteMapBlobPath && previous.siteMapBlobPath !== blobPath) {
    await deleteDocumentBlob(previous.siteMapBlobPath);
  }
  return { ok: true };
}

export async function removeSiteMap(
  viewer: PlatformViewer,
  siteId: string,
): Promise<MapResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const row = await readRecord(siteId);
  if (!row?.siteMapBlobPath) return { ok: true };

  await prisma.siteInformation.update({
    where: { jobSiteId: siteId },
    data: {
      siteMapBlobPath: null,
      siteMapFileName: null,
      siteMapMimeType: null,
      siteMapSizeBytes: null,
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
    },
  });
  await deleteDocumentBlob(row.siteMapBlobPath);
  return { ok: true };
}

/**
 * Read a checked-in worker's site-map bytes' blob path. The route re-derives the
 * worker's active site, so this only needs the site id. Returns null when no map
 * is set.
 */
export async function getSiteMapBlobForSite(
  siteId: string,
): Promise<{ blobPath: string; mimeType: string; fileName: string } | null> {
  const row = await prisma.siteInformation.findUnique({
    where: { jobSiteId: siteId },
    select: {
      siteMapBlobPath: true,
      siteMapMimeType: true,
      siteMapFileName: true,
    },
  });
  if (!row?.siteMapBlobPath) return null;
  return {
    blobPath: row.siteMapBlobPath,
    mimeType: row.siteMapMimeType || 'image/jpeg',
    fileName: row.siteMapFileName || 'site-map',
  };
}

// ─── Worker-facing read ──────────────────────────────────────────────────────

export interface WorkerSiteInformation {
  address: string;
  jobReference: string;
  /** GPS coords (SC-007) for a "Get directions" link, when set. */
  latitude: number | null;
  longitude: number | null;
  siteManager: { name: string | null; phone: string | null } | null;
  emergency: {
    fireAssemblyPoint: string | null;
    firstAiderName: string | null;
    firstAiderNumber: string | null;
    firstAiderLocation: string | null;
    nearestHospital: string | null;
    emergencyNumber: string | null;
  };
  info: SiteInformationFields;
  latestNotice: {
    title: string | null;
    body: string;
    category: string;
    publishedAt: Date;
  } | null;
}

/** Everything the worker Site Information page renders, in one call. */
export async function getWorkerSiteInformation(
  siteId: string,
): Promise<WorkerSiteInformation | null> {
  const [site, info, manager, notice] = await Promise.all([
    prisma.jobSite.findUnique({
      where: { id: siteId },
      select: {
        jobReference: true,
        addressLine1: true,
        addressLine2: true,
        town: true,
        postcode: true,
        latitude: true,
        longitude: true,
        fireAssemblyPoint: true,
        firstAiderName: true,
        firstAiderNumber: true,
        firstAiderLocation: true,
        nearestHospital: true,
        emergencyNumber: true,
      },
    }),
    readRecord(siteId),
    // Site manager = the first contact whose role reads like "Site Manager".
    prisma.siteContact.findFirst({
      where: {
        jobSiteId: siteId,
        role: { contains: 'manager', mode: 'insensitive' },
      },
      orderBy: { order: 'asc' },
      select: { name: true, phone: true },
    }),
    prisma.siteBulletin.findFirst({
      where: { jobSiteId: siteId, active: true },
      orderBy: { publishedAt: 'desc' },
      select: { title: true, body: true, category: true, publishedAt: true },
    }),
  ]);
  if (!site) return null;

  const address = [
    site.addressLine1,
    site.addressLine2,
    site.town,
    site.postcode,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    address,
    jobReference: site.jobReference,
    latitude: site.latitude,
    longitude: site.longitude,
    siteManager: manager ? { name: manager.name, phone: manager.phone } : null,
    emergency: {
      fireAssemblyPoint: site.fireAssemblyPoint,
      firstAiderName: site.firstAiderName,
      firstAiderNumber: site.firstAiderNumber,
      firstAiderLocation: site.firstAiderLocation,
      nearestHospital: site.nearestHospital,
      emergencyNumber: site.emergencyNumber,
    },
    info: toFields(info),
    latestNotice: notice
      ? {
          title: notice.title,
          body: notice.body,
          category: notice.category,
          publishedAt: notice.publishedAt,
        }
      : null,
  };
}
