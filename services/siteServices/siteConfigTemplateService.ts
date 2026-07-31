import { SiteConfigTemplateCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canManageSiteConfigTemplates,
} from '@/services/platformUsers/platformPermissions';
import {
  getSiteServiceConfig,
  mandatoryPermitTypeIds,
  mandatoryActivityTypeIds,
} from '@/services/siteServices/siteServiceAvailability';
import {
  disableBlockedReason,
  mandatoryLockReason,
  type SiteServiceKind,
} from '@/services/siteServices/siteServiceCatalog';

/**
 * SC-021 Phase 2 — configuration templates.
 *
 * One mechanism serving three requirement bullets (project templates,
 * client-specific requirements, industry-specific templates): a named, reusable
 * bundle of availability decisions, distinguished only by its category.
 *
 * REPLACE SEMANTICS. Applying a template produces the same configuration
 * whatever the site had before. Merge semantics — touching only the items a
 * template names — would make the outcome depend on prior state, so the same
 * template would give different results on different sites, which defeats the
 * point of having one.
 *
 * Every apply is PREVIEWED FIRST. The preview and the apply run the same
 * resolution, so what the manager confirms is what happens.
 */

export interface TemplateItemInput {
  kind: SiteServiceKind;
  refId: string;
  enabled: boolean;
}

export interface ConfigTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  category: SiteConfigTemplateCategory;
  active: boolean;
  /** How many services the template switches OFF — the useful headline. */
  disabledCount: number;
  itemCount: number;
  createdByName: string | null;
  updatedAt: Date;
}

export type TemplateResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

const NAME_MAX = 80;

function nameIssue(name: string): string | null {
  const t = (name ?? '').trim();
  if (!t) return 'Enter a template name.';
  if (t.length > NAME_MAX)
    return `Template name must be ${NAME_MAX} characters or fewer.`;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Templates offered when applying. Anyone who may configure a site may use one. */
export async function listActiveConfigTemplates(): Promise<
  ConfigTemplateSummary[]
> {
  const rows = await prisma.siteConfigTemplate.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { items: { select: { enabled: true } } },
  });
  return rows.map(toSummary);
}

/** All templates for the library, including deactivated ones. */
export async function listAllConfigTemplates(): Promise<
  ConfigTemplateSummary[]
> {
  const rows = await prisma.siteConfigTemplate.findMany({
    orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    include: { items: { select: { enabled: true } } },
  });
  return rows.map(toSummary);
}

function toSummary(r: {
  id: string;
  name: string;
  description: string | null;
  category: SiteConfigTemplateCategory;
  active: boolean;
  createdByName: string | null;
  updatedAt: Date;
  items: { enabled: boolean }[];
}): ConfigTemplateSummary {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    active: r.active,
    disabledCount: r.items.filter((i) => !i.enabled).length,
    itemCount: r.items.length,
    createdByName: r.createdByName,
    updatedAt: r.updatedAt,
  };
}

export async function getConfigTemplate(id: string) {
  const t = await prisma.siteConfigTemplate.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          permitType: { select: { id: true, name: true } },
          auditTemplate: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    active: t.active,
    createdByName: t.createdByName,
    items: t.items.map((i) => ({
      kind: (i.permitTypeId
        ? 'PERMIT_TYPE'
        : 'ACTIVITY_TYPE') as SiteServiceKind,
      refId: (i.permitTypeId ?? i.auditTemplateId)!,
      name: (i.permitType?.name ?? i.auditTemplate?.name)!,
      enabled: i.enabled,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Authoring                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Create a template.
 *
 * Gated on `sites:edit`, not on the manage roles: anyone who may configure a
 * site may capture that configuration for reuse. Editing or deleting a SHARED
 * template is the restricted act, because it changes what everyone else gets —
 * exactly the split SC-013 uses for audit templates.
 */
export async function createConfigTemplate(
  viewer: PlatformViewer,
  input: {
    name: string;
    description?: string | null;
    category: SiteConfigTemplateCategory;
    items: TemplateItemInput[];
  },
): Promise<TemplateResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  const issue = nameIssue(input.name);
  if (issue) return { ok: false, reason: 'invalid', error: issue };

  const clash = await prisma.siteConfigTemplate.findUnique({
    where: { name: input.name.trim() },
    select: { id: true },
  });
  if (clash) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'A template with that name already exists.',
    };
  }

  const rows = await resolveItems(input.items);
  const created = await prisma.siteConfigTemplate.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
      items: { create: rows },
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/**
 * Capture a site's CURRENT configuration as a new template.
 *
 * This is how real templates get made — from a project already set up
 * correctly, rather than by ticking 19 boxes from memory. Records every
 * catalogue item explicitly (not just the overrides) so the template remains a
 * complete statement even if the defaults change later.
 */
export async function saveSiteAsConfigTemplate(
  viewer: PlatformViewer,
  siteId: string,
  input: {
    name: string;
    description?: string | null;
    category: SiteConfigTemplateCategory;
  },
): Promise<TemplateResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  const groups = await getSiteServiceConfig(viewer, siteId);
  if (!groups) return { ok: false, reason: 'not_found' };

  const items: TemplateItemInput[] = groups.flatMap((g) =>
    g.items.map((i) => ({ kind: g.kind, refId: i.id, enabled: i.enabled })),
  );
  return createConfigTemplate(viewer, { ...input, items });
}

/** Edit a shared template. Restricted — it changes what every future site gets. */
export async function updateConfigTemplate(
  viewer: PlatformViewer,
  id: string,
  input: {
    name: string;
    description?: string | null;
    category: SiteConfigTemplateCategory;
    items: TemplateItemInput[];
  },
): Promise<TemplateResult> {
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const issue = nameIssue(input.name);
  if (issue) return { ok: false, reason: 'invalid', error: issue };

  const existing = await prisma.siteConfigTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  const clash = await prisma.siteConfigTemplate.findFirst({
    where: { name: input.name.trim(), id: { not: id } },
    select: { id: true },
  });
  if (clash) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'A template with that name already exists.',
    };
  }

  const rows = await resolveItems(input.items);
  // Rewrite the item set rather than diffing it: a template is a complete
  // statement, so a partial update would leave stale decisions behind.
  await prisma.$transaction([
    prisma.siteConfigTemplateItem.deleteMany({ where: { templateId: id } }),
    prisma.siteConfigTemplate.update({
      where: { id },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        category: input.category,
        updatedByUserId: viewer.id,
        updatedByName: viewer.name,
        items: { create: rows },
      },
    }),
  ]);
  return { ok: true, id };
}

export async function setConfigTemplateActive(
  viewer: PlatformViewer,
  id: string,
  active: boolean,
): Promise<TemplateResult> {
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const existing = await prisma.siteConfigTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };
  await prisma.siteConfigTemplate.update({
    where: { id },
    data: { active, updatedByUserId: viewer.id, updatedByName: viewer.name },
  });
  return { ok: true, id };
}

/**
 * Delete a template.
 *
 * Sites that were configured from it are unaffected: their settings are their
 * own rows, and their provenance is a stored STRING rather than a link, so
 * deleting a template never rewrites what a site records about its own past.
 */
export async function deleteConfigTemplate(
  viewer: PlatformViewer,
  id: string,
): Promise<TemplateResult> {
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const existing = await prisma.siteConfigTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };
  await prisma.siteConfigTemplate.delete({ where: { id } });
  return { ok: true, id };
}

/** Validate item ids against the live catalogues and shape them for Prisma. */
async function resolveItems(items: TemplateItemInput[]) {
  const permitIds = items
    .filter((i) => i.kind === 'PERMIT_TYPE')
    .map((i) => i.refId);
  const activityIds = items
    .filter((i) => i.kind === 'ACTIVITY_TYPE')
    .map((i) => i.refId);

  const [validPermits, validActivities] = await Promise.all([
    permitIds.length
      ? prisma.permitType.findMany({
          where: { id: { in: permitIds } },
          select: { id: true },
        })
      : Promise.resolve([]),
    activityIds.length
      ? prisma.auditTemplate.findMany({
          where: { id: { in: activityIds } },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  const okPermits = new Set(validPermits.map((r) => r.id));
  const okActivities = new Set(validActivities.map((r) => r.id));

  // Unknown ids are dropped rather than stored. A row pointing at nothing would
  // apply silently as a no-op and be invisible in the library.
  return items
    .filter((i) =>
      i.kind === 'PERMIT_TYPE'
        ? okPermits.has(i.refId)
        : okActivities.has(i.refId),
    )
    .map((i) => ({
      permitTypeId: i.kind === 'PERMIT_TYPE' ? i.refId : null,
      auditTemplateId: i.kind === 'ACTIVITY_TYPE' ? i.refId : null,
      enabled: i.enabled,
    }));
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

export interface ApplyChange {
  kind: SiteServiceKind;
  refId: string;
  name: string;
  from: boolean;
  to: boolean;
}

export interface ApplyPreview {
  templateId: string;
  templateName: string;
  turningOn: ApplyChange[];
  turningOff: ApplyChange[];
  /** Cannot be turned off — active schedules. Each carries its own reason. */
  blocked: { name: string; reason: string }[];
  /** Cannot be turned off — company policy. */
  forcedOn: { name: string; reason: string }[];
  unchangedCount: number;
}

export type ApplyResult =
  | { ok: true; applied: ApplyPreview }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/**
 * Work out exactly what applying a template would do, without writing anything.
 *
 * The preview is the safeguard that makes REPLACE semantics safe to offer: a
 * manager sees every change, every refusal and the reason for each before
 * anything happens. `applyConfigTemplate` calls this same function, so what is
 * confirmed is what runs.
 */
export async function previewConfigTemplate(
  viewer: PlatformViewer,
  siteId: string,
  templateId: string,
): Promise<
  | { ok: true; preview: ApplyPreview }
  | { ok: false; reason: 'forbidden' | 'not_found' }
> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  const groups = await getSiteServiceConfig(viewer, siteId);
  if (!groups) return { ok: false, reason: 'not_found' };

  const template = await getConfigTemplate(templateId);
  if (!template) return { ok: false, reason: 'not_found' };

  const wanted = new Map(
    template.items.map((i) => [`${i.kind}:${i.refId}`, i.enabled]),
  );

  const preview: ApplyPreview = {
    templateId: template.id,
    templateName: template.name,
    turningOn: [],
    turningOff: [],
    blocked: [],
    forcedOn: [],
    unchangedCount: 0,
  };

  for (const group of groups) {
    for (const item of group.items) {
      // REPLACE: an item the template doesn't mention returns to the default,
      // which is available. That is what makes the outcome independent of the
      // site's prior state.
      const target = wanted.get(`${group.kind}:${item.id}`) ?? true;

      if (item.mandatory && !target) {
        preview.forcedOn.push({
          name: item.name,
          reason: mandatoryLockReason(item.mandatoryReason),
        });
        continue;
      }
      if (item.enabled === target) {
        preview.unchangedCount++;
        continue;
      }
      if (!target && item.blockingSchedules.length > 0) {
        preview.blocked.push({
          name: item.name,
          reason: disableBlockedReason(item.name, item.blockingSchedules),
        });
        continue;
      }
      const change: ApplyChange = {
        kind: group.kind,
        refId: item.id,
        name: item.name,
        from: item.enabled,
        to: target,
      };
      if (target) preview.turningOn.push(change);
      else preview.turningOff.push(change);
    }
  }
  return { ok: true, preview };
}

/**
 * Apply a template to a site.
 *
 * Applies every non-conflicting change in ONE transaction and reports the
 * blocked ones individually. Refusing the whole application because one
 * inspection has a live schedule would be unhelpful; skipping it silently would
 * be dishonest. Naming it is the middle path, and it reuses Phase 1's block
 * rule rather than inventing a second one.
 */
export async function applyConfigTemplate(
  viewer: PlatformViewer,
  siteId: string,
  templateId: string,
): Promise<ApplyResult> {
  const pre = await previewConfigTemplate(viewer, siteId, templateId);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  const { preview } = pre;

  const stamp = { updatedByUserId: viewer.id, updatedByName: viewer.name };
  const writes = [...preview.turningOn, ...preview.turningOff].map((c) =>
    c.kind === 'PERMIT_TYPE'
      ? prisma.sitePermitTypeSetting.upsert({
          where: {
            jobSiteId_permitTypeId: {
              jobSiteId: siteId,
              permitTypeId: c.refId,
            },
          },
          create: {
            jobSiteId: siteId,
            permitTypeId: c.refId,
            enabled: c.to,
            ...stamp,
          },
          update: { enabled: c.to, ...stamp },
        })
      : prisma.siteActivityTypeSetting.upsert({
          where: {
            jobSiteId_auditTemplateId: {
              jobSiteId: siteId,
              auditTemplateId: c.refId,
            },
          },
          create: {
            jobSiteId: siteId,
            auditTemplateId: c.refId,
            enabled: c.to,
            ...stamp,
          },
          update: { enabled: c.to, ...stamp },
        }),
  );

  await prisma.$transaction([
    ...writes,
    // Provenance is recorded even when every change was blocked: "this template
    // was applied here, on this date, by this person" is true either way, and
    // the manager needs to know which template a site was set up from.
    prisma.jobSite.update({
      where: { id: siteId },
      data: {
        appliedConfigTemplateName: preview.templateName,
        appliedConfigTemplateAt: new Date(),
        appliedConfigTemplateBy: viewer.name,
      },
    }),
  ]);

  return { ok: true, applied: preview };
}

/* -------------------------------------------------------------------------- */
/* Company mandatory policy                                                    */
/* -------------------------------------------------------------------------- */

export interface MandatoryPolicyRow {
  kind: SiteServiceKind;
  refId: string;
  name: string;
  reason: string | null;
  mandatory: boolean;
}

/** Every catalogue item with its company policy state, for the Director's screen. */
export async function listMandatoryPolicy(): Promise<MandatoryPolicyRow[]> {
  const [permitTypes, templates, policies] = await Promise.all([
    prisma.permitType.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.auditTemplate.findMany({
      where: { active: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.orgServicePolicy.findMany({
      select: { permitTypeId: true, auditTemplateId: true, reason: true },
    }),
  ]);
  const byPermit = new Map(
    policies
      .filter((p) => p.permitTypeId)
      .map((p) => [p.permitTypeId!, p.reason]),
  );
  const byActivity = new Map(
    policies
      .filter((p) => p.auditTemplateId)
      .map((p) => [p.auditTemplateId!, p.reason]),
  );
  return [
    ...permitTypes.map((t) => ({
      kind: 'PERMIT_TYPE' as const,
      refId: t.id,
      name: t.name,
      reason: byPermit.get(t.id) ?? null,
      mandatory: byPermit.has(t.id),
    })),
    ...templates.map((t) => ({
      kind: 'ACTIVITY_TYPE' as const,
      refId: t.id,
      name: t.name,
      reason: byActivity.get(t.id) ?? null,
      mandatory: byActivity.has(t.id),
    })),
  ];
}

export type MandatoryResult =
  | { ok: true; sitesAffected: number }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

/**
 * How many sites currently have this service switched off.
 *
 * Setting a policy overrides those sites, so the confirmation must state the
 * number. A company requirement that silently left non-compliant sites alone
 * would be worse than no requirement at all.
 */
export async function countSitesOverriddenBy(
  kind: SiteServiceKind,
  refId: string,
): Promise<number> {
  return kind === 'PERMIT_TYPE'
    ? prisma.sitePermitTypeSetting.count({
        where: { permitTypeId: refId, enabled: false },
      })
    : prisma.siteActivityTypeSetting.count({
        where: { auditTemplateId: refId, enabled: false },
      });
}

/**
 * Set or clear a company-mandatory service. DIRECTOR ONLY — this is company
 * policy, not site configuration, so it uses the narrowest existing gate.
 *
 * Setting a policy CLEARS the site-level disables it overrides, rather than
 * leaving them dormant underneath. Leaving them would mean that clearing the
 * policy later silently re-hid the service on those sites, long after anyone
 * remembered why.
 */
export async function setMandatoryPolicy(
  viewer: PlatformViewer,
  kind: SiteServiceKind,
  refId: string,
  mandatory: boolean,
  reason?: string | null,
): Promise<MandatoryResult> {
  // Director-only: canEditSite is the narrowest existing capability and already
  // means "may change things that affect a whole site".
  if (viewer.role !== 'DIRECTOR') return { ok: false, reason: 'forbidden' };

  const exists =
    kind === 'PERMIT_TYPE'
      ? await prisma.permitType.findFirst({
          where: { id: refId, active: true },
          select: { id: true },
        })
      : await prisma.auditTemplate.findFirst({
          where: { id: refId, active: true },
          select: { id: true },
        });
  if (!exists)
    return { ok: false, reason: 'invalid', error: 'Unknown service.' };

  if (!mandatory) {
    if (kind === 'PERMIT_TYPE') {
      await prisma.orgServicePolicy.deleteMany({
        where: { permitTypeId: refId },
      });
    } else {
      await prisma.orgServicePolicy.deleteMany({
        where: { auditTemplateId: refId },
      });
    }
    return { ok: true, sitesAffected: 0 };
  }

  const sitesAffected = await countSitesOverriddenBy(kind, refId);
  const stamp = { updatedByUserId: viewer.id, updatedByName: viewer.name };

  if (kind === 'PERMIT_TYPE') {
    await prisma.$transaction([
      prisma.orgServicePolicy.upsert({
        where: { permitTypeId: refId },
        create: {
          permitTypeId: refId,
          reason: reason?.trim() || null,
          ...stamp,
        },
        update: { reason: reason?.trim() || null, ...stamp },
      }),
      prisma.sitePermitTypeSetting.updateMany({
        where: { permitTypeId: refId, enabled: false },
        data: { enabled: true, ...stamp },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.orgServicePolicy.upsert({
        where: { auditTemplateId: refId },
        create: {
          auditTemplateId: refId,
          reason: reason?.trim() || null,
          ...stamp,
        },
        update: { reason: reason?.trim() || null, ...stamp },
      }),
      prisma.siteActivityTypeSetting.updateMany({
        where: { auditTemplateId: refId, enabled: false },
        data: { enabled: true, ...stamp },
      }),
    ]);
  }
  return { ok: true, sitesAffected };
}

/** Re-exported so callers don't need two imports to reason about locks. */
export { mandatoryPermitTypeIds, mandatoryActivityTypeIds };
