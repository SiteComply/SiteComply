import { prisma } from '@/lib/prisma';
import {
  PERMISSION_VERBS,
  permits,
  isPlatformModule,
  type PlatformModule,
  type PermissionVerb,
} from '@/services/platformUsers/platformPermissions';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import {
  CONTRACTOR_STANDARD_PRESET,
  CONTRACTOR_STANDARD_LABEL,
  NARROWABLE_MODULES,
  narrow,
} from '@/services/platformUsers/contractorAccessConstants';
import { getPermissionTemplate } from '@/services/platformUsers/permissionTemplateService';

/**
 * SC-022 Phase 1 — managing contractor access to a site.
 *
 * THE INVARIANT, enforced here and in the resolver: an override can only ever
 * REMOVE access. Stored verbs are intersected with the role baseline on write
 * AND on read, so neither a malformed request nor a stale row left behind by a
 * role change can grant a capability the role does not hold. Permission
 * configuration must not become a privilege-escalation route.
 *
 * Two people can never be narrowed:
 *   - a DIRECTOR, the only all-sites role — an organisation that can lock its
 *     own Directors out has no way back in;
 *   - YOURSELF, so nobody can accidentally remove their own ability to undo it.
 *
 * Every change is written to PermissionChangeLog in the same transaction as the
 * change itself, so the trail cannot drift from reality.
 */

export interface ModuleAccessRow {
  module: PlatformModule;
  label: string;
  /** What the role grants before any narrowing. */
  baseline: PermissionVerb[];
  /** What the user actually has on this site. */
  effective: PermissionVerb[];
  /** True when an override is stored for this (user, site, module). */
  overridden: boolean;
}

export interface SiteUserAccess {
  userId: string;
  name: string;
  company: string;
  role: PlatformRoleValue;
  /** True when the preset would change nothing — already at or below it. */
  matchesPreset: boolean;
  /** Narrowing is refused for these (Director, or the viewer themselves). */
  lockedReason: string | null;
  modules: ModuleAccessRow[];
}

export type AccessResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/**
 * Who may configure contractor access on a site.
 *
 * Site Managers are included because SC-022 asks for exactly that, but the site
 * boundary still applies: `viewer.siteIds` is checked on every call, so a Site
 * Manager can only configure the sites they hold. This is narrower than
 * managing the platform user record itself, which remains Admin Centre-only.
 */
export function canManageContractorAccess(role: PlatformRoleValue): boolean {
  return (
    role === 'DIRECTOR' || role === 'PROJECT_MANAGER' || role === 'SITE_MANAGER'
  );
}

function baselineFor(
  role: PlatformRoleValue,
  module: PlatformModule,
): PermissionVerb[] {
  return PERMISSION_VERBS.filter((v) => permits(role, module, v));
}

function lockedReasonFor(
  viewer: PlatformViewer,
  targetId: string,
  targetRole: PlatformRoleValue,
): string | null {
  if (targetRole === 'DIRECTOR') {
    return 'Directors have organisation-wide access and cannot be restricted here.';
  }
  if (targetId === viewer.id) {
    return 'You cannot change your own access.';
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everyone assigned to a site, with their effective access per module.
 *
 * Returns null when the site is outside the viewer's scope — 404, not 403, so
 * the response never confirms that a site exists.
 */
export async function getSiteAccess(
  viewer: PlatformViewer,
  siteId: string,
): Promise<SiteUserAccess[] | null> {
  if (!viewer.siteIds.includes(siteId)) return null;

  const [users, overrides] = await Promise.all([
    prisma.platformUser.findMany({
      where: { status: 'ACTIVE', assignedSites: { some: { id: siteId } } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, company: true, role: true },
    }),
    prisma.siteUserPermission.findMany({
      where: { jobSiteId: siteId },
      select: { platformUserId: true, module: true, verbs: true },
    }),
  ]);

  const byUser = new Map<string, Map<string, PermissionVerb[]>>();
  for (const o of overrides) {
    if (!isPlatformModule(o.module)) continue;
    const m = byUser.get(o.platformUserId) ?? new Map();
    m.set(o.module, o.verbs as PermissionVerb[]);
    byUser.set(o.platformUserId, m);
  }

  return users.map((u) => {
    const role = u.role as PlatformRoleValue;
    const stored = byUser.get(u.id);

    const modules: ModuleAccessRow[] = NARROWABLE_MODULES.map((module) => {
      const baseline = baselineFor(role, module);
      const override = stored?.get(module);
      return {
        module,
        label: module,
        baseline,
        // Intersected on READ as well as on write: a stored row that a later
        // role change made too generous still cannot widen anything.
        effective: narrow(baseline, override),
        overridden: override !== undefined,
      };
    });

    // "Already at or below the preset" — applying it would take nothing further
    // away, so the button can say so instead of implying a change.
    const matchesPreset = NARROWABLE_MODULES.every((module) => {
      const target = narrow(
        baselineFor(role, module),
        CONTRACTOR_STANDARD_PRESET[module],
      );
      const current = modules.find((m) => m.module === module)!.effective;
      return current.every((v) => target.includes(v));
    });

    return {
      userId: u.id,
      name: u.name,
      company: u.company,
      role,
      matchesPreset,
      lockedReason: lockedReasonFor(viewer, u.id, role),
      modules,
    };
  });
}

/** The permission-change history for a site, newest first. */
export async function getSiteAccessHistory(
  viewer: PlatformViewer,
  siteId: string,
  take = 50,
) {
  if (!viewer.siteIds.includes(siteId)) return null;
  return prisma.permissionChangeLog.findMany({
    where: { jobSiteId: siteId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

async function guard(
  viewer: PlatformViewer,
  siteId: string,
  targetUserId: string,
): Promise<
  | {
      ok: true;
      site: { id: string; name: string };
      target: { id: string; name: string; role: PlatformRoleValue };
    }
  | { ok: false; reason: 'forbidden' | 'not_found'; error?: string }
> {
  if (!canManageContractorAccess(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true, name: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const target = await prisma.platformUser.findFirst({
    where: { id: targetUserId, assignedSites: { some: { id: siteId } } },
    select: { id: true, name: true, role: true },
  });
  if (!target) return { ok: false, reason: 'not_found' };

  const role = target.role as PlatformRoleValue;
  const locked = lockedReasonFor(viewer, target.id, role);
  if (locked) return { ok: false, reason: 'forbidden', error: locked };

  return { ok: true, site, target: { id: target.id, name: target.name, role } };
}

/** Set the verbs a user keeps for one module on one site. */
export async function setModuleAccess(
  viewer: PlatformViewer,
  siteId: string,
  targetUserId: string,
  module: string,
  verbs: string[],
): Promise<AccessResult> {
  const g = await guard(viewer, siteId, targetUserId);
  if (!g.ok) return g;

  if (!isPlatformModule(module) || !NARROWABLE_MODULES.includes(module)) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'That module cannot be changed here.',
    };
  }
  const requested = verbs.filter((v): v is PermissionVerb =>
    (PERMISSION_VERBS as string[]).includes(v),
  );

  const baseline = baselineFor(g.target.role, module);
  // NARROW-ONLY: the intersection is what gets stored, so a request asking for
  // more than the role allows silently yields less, never more.
  const next = narrow(baseline, requested);

  const existing = await prisma.siteUserPermission.findUnique({
    where: {
      platformUserId_jobSiteId_module: {
        platformUserId: targetUserId,
        jobSiteId: siteId,
        module,
      },
    },
    select: { verbs: true },
  });
  const before = narrow(
    baseline,
    existing?.verbs as PermissionVerb[] | undefined,
  );

  await prisma.$transaction([
    // At the baseline again → delete the row rather than storing a no-op, so
    // "overridden" keeps meaning "deliberately restricted".
    next.length === baseline.length
      ? prisma.siteUserPermission.deleteMany({
          where: { platformUserId: targetUserId, jobSiteId: siteId, module },
        })
      : prisma.siteUserPermission.upsert({
          where: {
            platformUserId_jobSiteId_module: {
              platformUserId: targetUserId,
              jobSiteId: siteId,
              module,
            },
          },
          create: {
            platformUserId: targetUserId,
            jobSiteId: siteId,
            module,
            verbs: next,
            updatedByUserId: viewer.id,
            updatedByName: viewer.name,
          },
          update: {
            verbs: next,
            updatedByUserId: viewer.id,
            updatedByName: viewer.name,
          },
        }),
    prisma.permissionChangeLog.create({
      data: {
        actorUserId: viewer.id,
        actorName: viewer.name,
        targetUserId,
        targetName: g.target.name,
        targetRole: g.target.role,
        jobSiteId: siteId,
        jobSiteName: g.site.name,
        action: next.length === baseline.length ? 'RESET' : 'NARROW',
        module,
        beforeVerbs: before,
        afterVerbs: next,
      },
    }),
  ]);
  return { ok: true };
}

/**
 * Apply a permission template to one user on one site.
 *
 * SC-022 Phase 2: templates are now real records, so this takes a template id.
 * The seeded Contractor (standard) row is the definition the Phase 1 button
 * points at — one source of truth rather than a code constant and a record that
 * can drift apart.
 *
 * A template is applied through the SAME narrowing as a manual change, so it
 * cannot grant anything: `narrow` is still the only path to a stored value.
 */
export async function applyPermissionTemplate(
  viewer: PlatformViewer,
  siteId: string,
  targetUserId: string,
  templateId: string,
): Promise<AccessResult> {
  const g = await guard(viewer, siteId, targetUserId);
  if (!g.ok) return g;

  const template = await getPermissionTemplate(templateId);
  if (!template || !template.active) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'That template is not available.',
    };
  }
  const override: Record<string, PermissionVerb[]> = {};
  for (const i of template.items) override[i.module] = i.verbs;

  return applyOverrideMap(
    viewer,
    g,
    siteId,
    targetUserId,
    override,
    template.name,
  );
}

/** Apply the built-in Contractor (standard) template. */
export async function applyContractorPreset(
  viewer: PlatformViewer,
  siteId: string,
  targetUserId: string,
): Promise<AccessResult> {
  const seeded = await prisma.permissionTemplate.findUnique({
    where: { name: CONTRACTOR_STANDARD_LABEL },
    select: { id: true, active: true },
  });
  if (seeded?.active) {
    return applyPermissionTemplate(viewer, siteId, targetUserId, seeded.id);
  }
  // Falls back to the code constant if the seed has not run or the built-in was
  // deactivated, so the shipped button never simply stops working.
  const g = await guard(viewer, siteId, targetUserId);
  if (!g.ok) return g;
  return applyOverrideMap(
    viewer,
    g,
    siteId,
    targetUserId,
    CONTRACTOR_STANDARD_PRESET as Record<string, PermissionVerb[]>,
    CONTRACTOR_STANDARD_LABEL,
  );
}

/** Shared application path for a preset or a template. */
async function applyOverrideMap(
  viewer: PlatformViewer,
  g: {
    site: { id: string; name: string };
    target: { id: string; name: string; role: PlatformRoleValue };
  },
  siteId: string,
  targetUserId: string,
  override: Record<string, PermissionVerb[]>,
  label: string,
): Promise<AccessResult> {
  const writes = [];
  const before: string[] = [];
  const after: string[] = [];

  for (const module of NARROWABLE_MODULES) {
    const baseline = baselineFor(g.target.role, module);
    // A module the template says nothing about is left at the role baseline,
    // rather than being silently emptied.
    const next = narrow(baseline, override[module]);
    before.push(`${module}:${baseline.join('/') || 'none'}`);
    after.push(`${module}:${next.join('/') || 'none'}`);

    writes.push(
      next.length === baseline.length
        ? prisma.siteUserPermission.deleteMany({
            where: { platformUserId: targetUserId, jobSiteId: siteId, module },
          })
        : prisma.siteUserPermission.upsert({
            where: {
              platformUserId_jobSiteId_module: {
                platformUserId: targetUserId,
                jobSiteId: siteId,
                module,
              },
            },
            create: {
              platformUserId: targetUserId,
              jobSiteId: siteId,
              module,
              verbs: next,
              updatedByUserId: viewer.id,
              updatedByName: viewer.name,
            },
            update: {
              verbs: next,
              updatedByUserId: viewer.id,
              updatedByName: viewer.name,
            },
          }),
    );
  }

  await prisma.$transaction([
    ...writes,
    prisma.permissionChangeLog.create({
      data: {
        actorUserId: viewer.id,
        actorName: viewer.name,
        targetUserId,
        targetName: g.target.name,
        targetRole: g.target.role,
        jobSiteId: siteId,
        jobSiteName: g.site.name,
        action: 'APPLY_PRESET',
        module: label,
        beforeVerbs: before,
        afterVerbs: after,
      },
    }),
  ]);
  return { ok: true };
}

/** Restore a user to their full role baseline on a site. */
export async function resetAccess(
  viewer: PlatformViewer,
  siteId: string,
  targetUserId: string,
): Promise<AccessResult> {
  const g = await guard(viewer, siteId, targetUserId);
  if (!g.ok) return g;

  await prisma.$transaction([
    prisma.siteUserPermission.deleteMany({
      where: { platformUserId: targetUserId, jobSiteId: siteId },
    }),
    prisma.permissionChangeLog.create({
      data: {
        actorUserId: viewer.id,
        actorName: viewer.name,
        targetUserId,
        targetName: g.target.name,
        targetRole: g.target.role,
        jobSiteId: siteId,
        jobSiteName: g.site.name,
        action: 'RESET',
        beforeVerbs: [],
        afterVerbs: [],
      },
    }),
  ]);
  return { ok: true };
}

/**
 * Remove a user from a site entirely — the requirement's "instantly revoke
 * access when contractors leave a project".
 *
 * Immediate by construction: `getPlatformViewer` re-reads assigned sites on
 * every request, so the next page load has already lost the site. The user
 * record itself is untouched (that stays Admin Centre territory) and their
 * history on the site — check-ins, permits, actions — is preserved, because
 * revoking access must not erase what someone did while they had it.
 */
export async function revokeSiteAccess(
  viewer: PlatformViewer,
  siteId: string,
  targetUserId: string,
): Promise<AccessResult> {
  const g = await guard(viewer, siteId, targetUserId);
  if (!g.ok) return g;

  await prisma.$transaction([
    prisma.platformUser.update({
      where: { id: targetUserId },
      data: { assignedSites: { disconnect: { id: siteId } } },
    }),
    // The overrides go with the assignment: leaving them would silently
    // re-apply if the user were ever added back, long after anyone remembered.
    prisma.siteUserPermission.deleteMany({
      where: { platformUserId: targetUserId, jobSiteId: siteId },
    }),
    prisma.permissionChangeLog.create({
      data: {
        actorUserId: viewer.id,
        actorName: viewer.name,
        targetUserId,
        targetName: g.target.name,
        targetRole: g.target.role,
        jobSiteId: siteId,
        jobSiteName: g.site.name,
        action: 'REVOKE_SITE',
        beforeVerbs: [],
        afterVerbs: [],
      },
    }),
  ]);
  return { ok: true };
}
