import { SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { canCreateSite } from '@/services/platformUsers/platformPermissions';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  validateSite,
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

  return { ok: true, id: site.id };
}
