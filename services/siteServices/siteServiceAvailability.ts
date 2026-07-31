import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { ACTIVE_PERMIT_STATUSES } from '@/services/permits/permitConstants';
import {
  disableBlockedReason,
  mandatoryLockReason,
  isSiteServiceKind,
  type SiteServiceGroup,
  type SiteServiceItem,
  type SiteServiceKind,
} from '@/services/siteServices/siteServiceCatalog';

/**
 * SC-021 Phase 1 — per-site availability of permit types and activity types.
 *
 * THE SINGLE SOURCE OF TRUTH. Every read path (worker permit picker, audit
 * creation, compliance scheduler) and every write path (createPermit,
 * createAudit, createSchedule) resolves availability through this module, so a
 * type hidden in one place cannot still be reachable in another.
 *
 * UI FILTERING IS NOT ENFORCEMENT. Hiding a type from a picker stops the honest
 * path only; the id is still guessable and postable. Every creation path
 * therefore re-checks server-side — the same rule SC-015 established for action
 * assignees, where the dropdown is advisory and the service re-resolves.
 *
 * OVERRIDES ONLY: absence of a row means AVAILABLE. No backfill, and a site
 * nobody has configured behaves exactly as it did before SC-021.
 */

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * SC-021 Phase 2 — company-mandatory services.
 *
 * Row presence means mandatory. Applied at the point availability is RESOLVED
 * rather than at each call site, so no read path and no future caller can
 * bypass it — the same construction as SC-003, where a locked panel is forced
 * on when visibility is read rather than trusted to every renderer.
 */
export async function mandatoryPermitTypeIds(): Promise<Set<string>> {
  const rows = await prisma.orgServicePolicy.findMany({
    where: { permitTypeId: { not: null } },
    select: { permitTypeId: true },
  });
  return new Set(rows.map((r) => r.permitTypeId!));
}

export async function mandatoryActivityTypeIds(): Promise<Set<string>> {
  const rows = await prisma.orgServicePolicy.findMany({
    where: { auditTemplateId: { not: null } },
    select: { auditTemplateId: true },
  });
  return new Set(rows.map((r) => r.auditTemplateId!));
}

/**
 * Ids explicitly turned OFF for a site. Everything else is available.
 *
 * A MANDATORY service is never in this set, however the site's rows read. A
 * stale override written before a policy existed therefore stops taking effect
 * the moment the policy is set — the policy wins on read, so there is no window
 * in which a site quietly ignores a company requirement.
 */
export async function disabledPermitTypeIds(
  siteId: string,
): Promise<Set<string>> {
  const [rows, mandatory] = await Promise.all([
    prisma.sitePermitTypeSetting.findMany({
      where: { jobSiteId: siteId, enabled: false },
      select: { permitTypeId: true },
    }),
    mandatoryPermitTypeIds(),
  ]);
  return new Set(
    rows.map((r) => r.permitTypeId).filter((id) => !mandatory.has(id)),
  );
}

export async function disabledActivityTypeIds(
  siteId: string,
): Promise<Set<string>> {
  const [rows, mandatory] = await Promise.all([
    prisma.siteActivityTypeSetting.findMany({
      where: { jobSiteId: siteId, enabled: false },
      select: { auditTemplateId: true },
    }),
    mandatoryActivityTypeIds(),
  ]);
  return new Set(
    rows.map((r) => r.auditTemplateId).filter((id) => !mandatory.has(id)),
  );
}

/**
 * The availability check the creation paths call. Written as "is it disabled?"
 * against stored rows rather than "is it enabled?", so a missing row can only
 * ever mean available — a query that returns nothing cannot accidentally deny
 * every type on the site.
 */
export async function isPermitTypeAvailable(
  siteId: string,
  permitTypeId: string,
): Promise<boolean> {
  const [row, policy] = await Promise.all([
    prisma.sitePermitTypeSetting.findUnique({
      where: { jobSiteId_permitTypeId: { jobSiteId: siteId, permitTypeId } },
      select: { enabled: true },
    }),
    prisma.orgServicePolicy.findUnique({
      where: { permitTypeId },
      select: { id: true },
    }),
  ]);
  if (policy) return true; // mandatory beats any site override
  return row ? row.enabled : true;
}

export async function isActivityTypeAvailable(
  siteId: string,
  auditTemplateId: string,
): Promise<boolean> {
  const [row, policy] = await Promise.all([
    prisma.siteActivityTypeSetting.findUnique({
      where: {
        jobSiteId_auditTemplateId: { jobSiteId: siteId, auditTemplateId },
      },
      select: { enabled: true },
    }),
    prisma.orgServicePolicy.findUnique({
      where: { auditTemplateId },
      select: { id: true },
    }),
  ]);
  if (policy) return true; // mandatory beats any site override
  return row ? row.enabled : true;
}

/**
 * For pickers that span several sites (audit creation, schedule creation): the
 * sites each type is turned OFF for.
 *
 * Returns the negative rather than the positive deliberately — overrides are
 * rare, so this payload stays tiny and the client can filter with
 * `!disabledSiteIds.includes(chosenSiteId)`. Sending the positive would mean
 * shipping every (site × type) pair.
 */
export async function disabledSitesByPermitType(
  siteIds: string[],
): Promise<Record<string, string[]>> {
  if (siteIds.length === 0) return {};
  const [rows, mandatory] = await Promise.all([
    prisma.sitePermitTypeSetting.findMany({
      where: { jobSiteId: { in: siteIds }, enabled: false },
      select: { permitTypeId: true, jobSiteId: true },
    }),
    mandatoryPermitTypeIds(),
  ]);
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (mandatory.has(r.permitTypeId)) continue;
    (out[r.permitTypeId] ??= []).push(r.jobSiteId);
  }
  return out;
}

export async function disabledSitesByActivityType(
  siteIds: string[],
): Promise<Record<string, string[]>> {
  if (siteIds.length === 0) return {};
  const [rows, mandatory] = await Promise.all([
    prisma.siteActivityTypeSetting.findMany({
      where: { jobSiteId: { in: siteIds }, enabled: false },
      select: { auditTemplateId: true, jobSiteId: true },
    }),
    mandatoryActivityTypeIds(),
  ]);
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (mandatory.has(r.auditTemplateId)) continue;
    (out[r.auditTemplateId] ??= []).push(r.jobSiteId);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Conflicts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Active compliance schedules on a site using an activity type.
 *
 * This is the blocking condition for disabling. Only ACTIVE schedules count —
 * a deactivated schedule generates nothing, so it is no reason to refuse.
 */
async function activeScheduleTitles(
  siteId: string,
  auditTemplateId: string,
): Promise<string[]> {
  const rows = await prisma.complianceSchedule.findMany({
    where: { jobSiteId: siteId, auditTemplateId, active: true },
    select: { title: true, auditTemplate: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.title || r.auditTemplate.name);
}

/* -------------------------------------------------------------------------- */
/* Configuration screen                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything the configuration UI needs for one site, in one call: both
 * catalogues, effective availability, and — crucially — the conflicts, so the
 * screen can disable a toggle and SAY WHY before the manager clicks it rather
 * than rejecting the click afterwards. (SC-014's lesson: a rule enforced only on
 * the server means the client happily submits what the API will refuse.)
 *
 * Returns null when the site is outside the viewer's scope.
 */
export async function getSiteServiceConfig(
  viewer: PlatformViewer,
  siteId: string,
): Promise<SiteServiceGroup[] | null> {
  if (!viewer.siteIds.includes(siteId)) return null;

  const [permitTypes, templates, permitOverrides, activityOverrides] =
    await Promise.all([
      prisma.permitType.findMany({
        where: { active: true },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, description: true },
      }),
      prisma.auditTemplate.findMany({
        where: { active: true },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, description: true },
      }),
      prisma.sitePermitTypeSetting.findMany({
        where: { jobSiteId: siteId },
        select: { permitTypeId: true, enabled: true },
      }),
      prisma.siteActivityTypeSetting.findMany({
        where: { jobSiteId: siteId },
        select: { auditTemplateId: true, enabled: true },
      }),
    ]);

  // SC-021 Phase 2 — company-mandatory services, with their stated reasons.
  const policies = await prisma.orgServicePolicy.findMany({
    select: { permitTypeId: true, auditTemplateId: true, reason: true },
  });
  const mandatoryPermit = new Map(
    policies
      .filter((p) => p.permitTypeId)
      .map((p) => [p.permitTypeId!, p.reason]),
  );
  const mandatoryActivity = new Map(
    policies
      .filter((p) => p.auditTemplateId)
      .map((p) => [p.auditTemplateId!, p.reason]),
  );

  const permitOverride = new Map(
    permitOverrides.map((r) => [r.permitTypeId, r.enabled]),
  );
  const activityOverride = new Map(
    activityOverrides.map((r) => [r.auditTemplateId, r.enabled]),
  );

  // Conflicts and in-flight counts, gathered in two grouped queries rather than
  // one per row.
  const [activeSchedules, inFlightPermits] = await Promise.all([
    prisma.complianceSchedule.findMany({
      where: { jobSiteId: siteId, active: true },
      select: {
        auditTemplateId: true,
        title: true,
        auditTemplate: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.permit.groupBy({
      by: ['permitTypeId'],
      where: { jobSiteId: siteId, status: { in: ACTIVE_PERMIT_STATUSES } },
      _count: { _all: true },
    }),
  ]);

  const schedulesByTemplate = new Map<string, string[]>();
  for (const s of activeSchedules) {
    const list = schedulesByTemplate.get(s.auditTemplateId) ?? [];
    list.push(s.title || s.auditTemplate.name);
    schedulesByTemplate.set(s.auditTemplateId, list);
  }
  const inFlightByPermitType = new Map(
    inFlightPermits.map((p) => [p.permitTypeId, p._count._all]),
  );

  const permitItems: SiteServiceItem[] = permitTypes.map((t) => {
    const mandatory = mandatoryPermit.has(t.id);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      // Mandatory forces ON regardless of what the site stored, matching what
      // the availability reads resolve — the screen must never show a service
      // as off while workers can still use it.
      enabled: mandatory ? true : (permitOverride.get(t.id) ?? true),
      configured: permitOverride.has(t.id),
      mandatory,
      mandatoryReason: mandatoryPermit.get(t.id) ?? null,
      // A permit type has no schedules, so nothing ever blocks disabling one.
      blockingSchedules: [],
      inFlightCount: inFlightByPermitType.get(t.id) ?? 0,
    };
  });

  const activityItems: SiteServiceItem[] = templates.map((t) => {
    const mandatory = mandatoryActivity.has(t.id);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      enabled: mandatory ? true : (activityOverride.get(t.id) ?? true),
      configured: activityOverride.has(t.id),
      mandatory,
      mandatoryReason: mandatoryActivity.get(t.id) ?? null,
      blockingSchedules: schedulesByTemplate.get(t.id) ?? [],
      inFlightCount: 0,
    };
  });

  return [
    { kind: 'PERMIT_TYPE', items: permitItems },
    { kind: 'ACTIVITY_TYPE', items: activityItems },
  ];
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

export type SetAvailabilityResult =
  | { ok: true; groups: SiteServiceGroup[] }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; error: string }
  | { ok: false; reason: 'blocked'; error: string }
  | { ok: false; reason: 'mandatory'; error: string };

/**
 * Turn one service on or off for one site.
 *
 * Gated on `sites:edit` — the capability Site Managers hold for their own sites
 * and Directors hold everywhere, which is exactly the pair SC-021 names. This
 * is availability configuration, NOT permission: who may *do* a thing still
 * comes from PLATFORM_PERMISSIONS, and nothing here can widen that.
 *
 * Enabling is never blocked. Only disabling can conflict, and only with active
 * schedules.
 */
export async function setSiteServiceEnabled(
  viewer: PlatformViewer,
  siteId: string,
  kind: SiteServiceKind,
  refId: string,
  enabled: boolean,
): Promise<SetAvailabilityResult> {
  if (!isSiteServiceKind(kind)) {
    return { ok: false, reason: 'invalid', error: 'Unknown service type.' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }

  const site = await prisma.jobSite.findFirst({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const stamp = { updatedByUserId: viewer.id, updatedByName: viewer.name };

  if (kind === 'PERMIT_TYPE') {
    // Unknown ids are rejected rather than stored, so a malformed request can
    // never leave a row pointing at nothing meaningful.
    const type = await prisma.permitType.findFirst({
      where: { id: refId, active: true },
      select: { id: true },
    });
    if (!type) {
      return { ok: false, reason: 'invalid', error: 'Unknown permit type.' };
    }
    if (!enabled) {
      const policy = await prisma.orgServicePolicy.findUnique({
        where: { permitTypeId: refId },
        select: { reason: true },
      });
      if (policy) {
        return {
          ok: false,
          reason: 'mandatory',
          error: mandatoryLockReason(policy.reason),
        };
      }
    }
    await prisma.sitePermitTypeSetting.upsert({
      where: {
        jobSiteId_permitTypeId: { jobSiteId: siteId, permitTypeId: refId },
      },
      create: { jobSiteId: siteId, permitTypeId: refId, enabled, ...stamp },
      update: { enabled, ...stamp },
    });
  } else {
    const template = await prisma.auditTemplate.findFirst({
      where: { id: refId, active: true },
      select: { id: true, name: true },
    });
    if (!template) {
      return {
        ok: false,
        reason: 'invalid',
        error: 'Unknown inspection type.',
      };
    }

    if (!enabled) {
      // Re-checked here, not just in the UI: the screen may have been open for a
      // while and a schedule created since it loaded.
      const titles = await activeScheduleTitles(siteId, refId);
      if (titles.length > 0) {
        return {
          ok: false,
          reason: 'blocked',
          error: disableBlockedReason(template.name, titles),
        };
      }
    }

    await prisma.siteActivityTypeSetting.upsert({
      where: {
        jobSiteId_auditTemplateId: {
          jobSiteId: siteId,
          auditTemplateId: refId,
        },
      },
      create: { jobSiteId: siteId, auditTemplateId: refId, enabled, ...stamp },
      update: { enabled, ...stamp },
    });
  }

  const groups = await getSiteServiceConfig(viewer, siteId);
  if (!groups) return { ok: false, reason: 'not_found' };
  return { ok: true, groups };
}
