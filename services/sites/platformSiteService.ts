import { SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { applyConfigTemplate } from '@/services/siteServices/siteConfigTemplateService';
import {
  canCreateSite,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  validateSite,
  setSiteStatus,
  defaultInductionChecklistSeed,
  type SiteInput,
  type FieldErrors,
} from '@/services/sites/adminSiteService';

/**
 * Platform-side (Director) job-site creation.
 *
 * Validation is shared with the admin path (`validateSite`) so both surfaces
 * enforce identical rules, and the new site is seeded with the same default UK
 * induction checklist so it is immediately usable by workers.
 *
 * Site-scoping: because a Director sees every site organisation-wide (their
 * `viewer.siteIds` is re-derived from all sites on every request), a newly
 * created site appears immediately across Sites, Site Details, reporting,
 * check-ins, audits, actions and documents with no further wiring — and it never
 * widens what any other, site-scoped role can see.
 */

export interface PlatformSiteInput extends SiteInput {
  /** 'ACTIVE' | 'ARCHIVED' — anything else defaults to ACTIVE. */
  status?: string;
  /**
   * SC-021 Phase 2 — optional configuration template applied on creation, so a
   * repeated project type arrives already configured.
   */
  configTemplateId?: string;
}

export type CreateSiteResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'no_admin' }
  | { ok: false; reason: 'validation'; errors: FieldErrors };

/** Parse the optional status input; only an explicit ARCHIVED archives. */
function parseStatus(status?: string): SiteStatus {
  return status === SiteStatus.ARCHIVED
    ? SiteStatus.ARCHIVED
    : SiteStatus.ACTIVE;
}

/**
 * Create a job site on behalf of a Director from the Platform portal.
 *
 * RBAC is enforced here as defence-in-depth (the page and API route also gate on
 * `canCreateSite`), so this service is safe to call from anywhere.
 *
 * `JobSite.createdByAdmin` is a required provenance relation and an internal
 * field (never surfaced in the UI). Platform users are not Admins, so the record
 * is attributed to the organisation's earliest-created admin as the system
 * creator — keeping the model intact with no schema change.
 */
export async function createSiteForDirector(
  viewer: PlatformViewer,
  input: PlatformSiteInput,
): Promise<CreateSiteResult> {
  if (!canCreateSite(viewer.role)) return { ok: false, reason: 'forbidden' };

  const validated = validateSite(input);
  if (!validated.ok) {
    return { ok: false, reason: 'validation', errors: validated.errors };
  }

  const attributor = await prisma.admin.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!attributor) return { ok: false, reason: 'no_admin' };

  const site = await prisma.jobSite.create({
    data: {
      ...validated.value,
      status: parseStatus(input.status),
      createdByAdminId: attributor.id,
      checklists: defaultInductionChecklistSeed(),
    },
    select: { id: true },
  });

  // SC-021 Phase 2 — apply a configuration template at creation, which is the
  // moment "commonly repeated project types" actually pays off: the site is
  // configured before anyone ever sees it misconfigured.
  //
  // Deliberately NOT fatal. The site exists and is usable; if the template can't
  // be applied, the Director can apply it from the site afterwards. Failing the
  // whole creation over a configuration convenience would be the wrong trade.
  if (input.configTemplateId) {
    try {
      // A Director has all sites in scope, but the viewer object was built
      // before this site existed, so the new id is added for the apply call.
      await applyConfigTemplate(
        { ...viewer, siteIds: [...viewer.siteIds, site.id] },
        site.id,
        input.configTemplateId,
      );
    } catch {
      // Swallowed on purpose — see above. The site is already created.
    }
  }

  return { ok: true, id: site.id };
}

/** All editable fields of a site, for pre-filling the Director edit form. */
export interface EditableSite {
  id: string;
  name: string;
  jobReference: string;
  status: 'ACTIVE' | 'ARCHIVED';
  addressLine1: string;
  addressLine2: string | null;
  town: string;
  postcode: string;
  inductionContent: string;
  fireAssemblyPoint: string | null;
  firstAiderName: string | null;
  firstAiderNumber: string | null;
  firstAiderLocation: string | null;
  nearestHospital: string | null;
  emergencyNumber: string | null;
}

/**
 * Load a site's full editable field set for a viewer, enforcing site-scoping:
 * returns null unless the site is in the viewer's scope (all sites for a
 * Director). Used to pre-fill the edit form; the update path re-checks scope.
 */
export async function getSiteForEditByViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<EditableSite | null> {
  if (!viewer.siteIds.includes(siteId)) return null; // out of scope → not found
  return prisma.jobSite.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      name: true,
      jobReference: true,
      status: true,
      addressLine1: true,
      addressLine2: true,
      town: true,
      postcode: true,
      inductionContent: true,
      fireAssemblyPoint: true,
      firstAiderName: true,
      firstAiderNumber: true,
      firstAiderLocation: true,
      nearestHospital: true,
      emergencyNumber: true,
    },
  });
}

export type UpdateSiteResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'validation'; errors: FieldErrors };

/**
 * Update an existing job site on behalf of a Director. Enforces the Director-only
 * edit capability AND site-scoping (the site must be in the viewer's scope), then
 * validates and writes the site's details, address and status in one update — so
 * a status change also archives/reactivates the site.
 *
 * Provenance is preserved: `createdByAdmin` is never touched, and `updatedAt`
 * advances automatically. Because every downstream view (documents, audits,
 * actions, check-ins, reporting, dashboard, Site Details) joins the live JobSite
 * row, edits are reflected immediately with no further wiring.
 */
export async function updateSiteForDirector(
  viewer: PlatformViewer,
  siteId: string,
  input: PlatformSiteInput,
): Promise<UpdateSiteResult> {
  if (!canEditSite(viewer.role)) return { ok: false, reason: 'forbidden' };
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  // Guard against a race where the site was removed after the scope check.
  const existing = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  const validated = validateSite(input);
  if (!validated.ok) {
    return { ok: false, reason: 'validation', errors: validated.errors };
  }

  await prisma.jobSite.update({
    where: { id: siteId },
    data: {
      ...validated.value,
      status: parseStatus(input.status),
    },
  });

  return { ok: true, id: siteId };
}

export type SetSiteStatusResult =
  | { ok: true; status: SiteStatus }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_status' };

/**
 * Archive or reactivate a site on behalf of a Director — the dedicated,
 * discoverable status action (distinct from the Edit form's status field). Same
 * Director-only capability and site-scoping as editing; archiving ONLY flips the
 * status, so all history (check-ins, reports, audits, actions, documents) is
 * untouched and stays available — an archived site simply disappears from the
 * worker check-in selection (which filters to ACTIVE). Provenance is preserved
 * and `updatedAt` advances via the shared `setSiteStatus` writer.
 */
export async function setSiteStatusForDirector(
  viewer: PlatformViewer,
  siteId: string,
  status: string,
): Promise<SetSiteStatusResult> {
  if (!canEditSite(viewer.role)) return { ok: false, reason: 'forbidden' };
  if (status !== SiteStatus.ACTIVE && status !== SiteStatus.ARCHIVED) {
    return { ok: false, reason: 'invalid_status' };
  }
  if (!viewer.siteIds.includes(siteId)) {
    return { ok: false, reason: 'not_found' };
  }

  const existing = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  const next: SiteStatus =
    status === SiteStatus.ARCHIVED ? SiteStatus.ARCHIVED : SiteStatus.ACTIVE;
  await setSiteStatus(siteId, next);
  return { ok: true, status: next };
}
