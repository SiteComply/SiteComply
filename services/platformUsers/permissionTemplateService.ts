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
  narrow,
  NARROWABLE_MODULES,
  CONTRACTOR_STANDARD_PRESET,
  CONTRACTOR_STANDARD_LABEL,
  CONTRACTOR_STANDARD_DESCRIPTION,
  type PermissionOverride,
} from '@/services/platformUsers/contractorAccessConstants';
import { canManageSiteConfigTemplates } from '@/services/platformUsers/platformPermissions';

/**
 * SC-022 Phase 2 — permission templates and company permission defaults.
 *
 * A template is a SHORTCUT FOR A DECISION, never a new source of authority: it
 * is applied through the same narrow-only resolver as a manual override, so it
 * can no more widen access than a person can.
 *
 * A company default is a LIVE FLOOR. The resolver intersects
 * role ∩ company default ∩ site override, so most restrictive wins and a Site
 * Manager cannot hand back what the company deliberately removed.
 */

export interface PermissionTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  isSystem: boolean;
  /** Modules the template removes something from — the useful headline. */
  restrictedCount: number;
  createdByName: string | null;
}

export interface PermissionTemplateDetail extends PermissionTemplateSummary {
  items: { module: PlatformModule; verbs: PermissionVerb[] }[];
}

export type TemplateResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

const NAME_MAX = 80;

/* -------------------------------------------------------------------------- */
/* Seed                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Seed the built-in Contractor (standard) template.
 *
 * Phase 1 shipped this preset as a CODE CONSTANT. Now that templates are real
 * records, keeping both would mean two sources of truth for the same decision,
 * so the constant becomes the SEED and the database row becomes the definition
 * everything reads. The row is marked isSystem so the library will not let it be
 * deleted out from under the Access tab that references it.
 *
 * Idempotent — upserts by name and rewrites its items, safe on every deploy.
 */
export async function seedPermissionTemplates(): Promise<number> {
  const existing = await prisma.permissionTemplate.findUnique({
    where: { name: CONTRACTOR_STANDARD_LABEL },
    select: { id: true },
  });
  const tpl = existing
    ? await prisma.permissionTemplate.update({
        where: { id: existing.id },
        data: {
          description: CONTRACTOR_STANDARD_DESCRIPTION,
          isSystem: true,
          active: true,
        },
        select: { id: true },
      })
    : await prisma.permissionTemplate.create({
        data: {
          name: CONTRACTOR_STANDARD_LABEL,
          description: CONTRACTOR_STANDARD_DESCRIPTION,
          isSystem: true,
          active: true,
          createdByName: 'SiteComply',
        },
        select: { id: true },
      });

  await prisma.permissionTemplateItem.deleteMany({
    where: { templateId: tpl.id },
  });
  await prisma.permissionTemplateItem.createMany({
    data: Object.entries(CONTRACTOR_STANDARD_PRESET).map(([module, verbs]) => ({
      templateId: tpl.id,
      module,
      verbs: verbs ?? [],
    })),
  });
  return 1;
}

/* -------------------------------------------------------------------------- */
/* Templates — read                                                            */
/* -------------------------------------------------------------------------- */

export async function listPermissionTemplates(
  includeInactive = false,
): Promise<PermissionTemplateSummary[]> {
  const rows = await prisma.permissionTemplate.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ active: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
    include: { items: { select: { verbs: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    active: r.active,
    isSystem: r.isSystem,
    restrictedCount: r.items.length,
    createdByName: r.createdByName,
  }));
}

export async function getPermissionTemplate(
  id: string,
): Promise<PermissionTemplateDetail | null> {
  const t = await prisma.permissionTemplate.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    active: t.active,
    isSystem: t.isSystem,
    restrictedCount: t.items.length,
    createdByName: t.createdByName,
    items: t.items
      .filter((i) => isPlatformModule(i.module))
      .map((i) => ({
        module: i.module as PlatformModule,
        verbs: i.verbs as PermissionVerb[],
      })),
  };
}

/** The template as a plain override map, for the resolver and the preview. */
export async function templateAsOverride(
  id: string,
): Promise<PermissionOverride | null> {
  const t = await getPermissionTemplate(id);
  if (!t) return null;
  const out: PermissionOverride = {};
  for (const i of t.items) out[i.module] = i.verbs;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Templates — write                                                           */
/* -------------------------------------------------------------------------- */

function validItems(
  items: { module: string; verbs: string[] }[],
): { module: string; verbs: string[] }[] {
  return items
    .filter(
      (i) =>
        isPlatformModule(i.module) &&
        (NARROWABLE_MODULES as string[]).includes(i.module),
    )
    .map((i) => ({
      module: i.module,
      verbs: i.verbs.filter((v) => (PERMISSION_VERBS as string[]).includes(v)),
    }));
}

export async function createPermissionTemplate(
  viewer: PlatformViewer,
  input: {
    name: string;
    description?: string | null;
    items: { module: string; verbs: string[] }[];
  },
): Promise<TemplateResult> {
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, reason: 'invalid', error: 'Enter a name.' };
  if (name.length > NAME_MAX) {
    return {
      ok: false,
      reason: 'invalid',
      error: `Name must be ${NAME_MAX} characters or fewer.`,
    };
  }
  const clash = await prisma.permissionTemplate.findUnique({
    where: { name },
    select: { id: true },
  });
  if (clash) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'A template with that name already exists.',
    };
  }

  const created = await prisma.permissionTemplate.create({
    data: {
      name,
      description: input.description?.trim() || null,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
      items: { create: validItems(input.items) },
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

export async function updatePermissionTemplate(
  viewer: PlatformViewer,
  id: string,
  input: {
    name: string;
    description?: string | null;
    items: { module: string; verbs: string[] }[];
  },
): Promise<TemplateResult> {
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const existing = await prisma.permissionTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, reason: 'invalid', error: 'Enter a name.' };
  const clash = await prisma.permissionTemplate.findFirst({
    where: { name, id: { not: id } },
    select: { id: true },
  });
  if (clash) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'A template with that name already exists.',
    };
  }

  // Rewrite the item set rather than diffing it: a template is a complete
  // statement, so a partial update would leave stale restrictions behind.
  await prisma.$transaction([
    prisma.permissionTemplateItem.deleteMany({ where: { templateId: id } }),
    prisma.permissionTemplate.update({
      where: { id },
      data: {
        name,
        description: input.description?.trim() || null,
        updatedByUserId: viewer.id,
        updatedByName: viewer.name,
        items: { create: validItems(input.items) },
      },
    }),
  ]);
  return { ok: true, id };
}

export async function setPermissionTemplateActive(
  viewer: PlatformViewer,
  id: string,
  active: boolean,
): Promise<TemplateResult> {
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const t = await prisma.permissionTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!t) return { ok: false, reason: 'not_found' };
  await prisma.permissionTemplate.update({
    where: { id },
    data: { active, updatedByUserId: viewer.id, updatedByName: viewer.name },
  });
  return { ok: true, id };
}

export async function deletePermissionTemplate(
  viewer: PlatformViewer,
  id: string,
): Promise<TemplateResult> {
  if (!canManageSiteConfigTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const t = await prisma.permissionTemplate.findUnique({
    where: { id },
    select: { id: true, isSystem: true },
  });
  if (!t) return { ok: false, reason: 'not_found' };
  if (t.isSystem) {
    // Deactivate instead. The Access tab references this template by name, so
    // deleting it would break a shipped button rather than merely tidy up.
    return {
      ok: false,
      reason: 'invalid',
      error:
        'Built-in templates cannot be deleted. Deactivate it instead if it is not useful.',
    };
  }
  await prisma.permissionTemplate.delete({ where: { id } });
  return { ok: true, id };
}

/* -------------------------------------------------------------------------- */
/* Company defaults                                                            */
/* -------------------------------------------------------------------------- */

export interface CompanyDefaultRow {
  module: PlatformModule;
  verbs: PermissionVerb[];
}

/** Companies already in use, so the UI offers a picker rather than free text. */
export async function listCompanies(): Promise<
  { company: string; users: number }[]
> {
  const rows = await prisma.platformUser.groupBy({
    by: ['company'],
    where: { status: 'ACTIVE' },
    _count: { _all: true },
    orderBy: { company: 'asc' },
  });
  return rows.map((r) => ({ company: r.company, users: r._count._all }));
}

export async function getCompanyDefaults(
  company: string,
): Promise<CompanyDefaultRow[]> {
  const rows = await prisma.companyPermissionDefault.findMany({
    where: { company },
    select: { module: true, verbs: true },
  });
  return rows
    .filter((r) => isPlatformModule(r.module))
    .map((r) => ({
      module: r.module as PlatformModule,
      verbs: r.verbs as PermissionVerb[],
    }));
}

/**
 * How many ACTIVE users a company rule would apply to.
 *
 * Shown before saving, so a typo in a free-text company name reads as
 * "0 users affected" rather than becoming a rule that silently does nothing.
 * Directors are excluded from the count because they are never narrowed.
 */
export async function countCompanyUsers(company: string): Promise<number> {
  return prisma.platformUser.count({
    where: { company, status: 'ACTIVE', role: { not: 'DIRECTOR' } },
  });
}

export type CompanyDefaultResult =
  | { ok: true; usersAffected: number }
  | { ok: false; reason: 'forbidden' | 'invalid'; error?: string };

/**
 * Set or clear a company-wide floor for one module. DIRECTOR ONLY — this is
 * company policy applying across every site, not the configuration of one.
 */
export async function setCompanyDefault(
  viewer: PlatformViewer,
  company: string,
  module: string,
  verbs: string[] | null,
): Promise<CompanyDefaultResult> {
  if (viewer.role !== 'DIRECTOR') return { ok: false, reason: 'forbidden' };
  if (!company.trim()) {
    return { ok: false, reason: 'invalid', error: 'Choose a company.' };
  }
  if (!isPlatformModule(module) || !NARROWABLE_MODULES.includes(module)) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'That section cannot be restricted.',
    };
  }

  const usersAffected = await countCompanyUsers(company);

  if (verbs === null) {
    await prisma.companyPermissionDefault.deleteMany({
      where: { company, module },
    });
    return { ok: true, usersAffected };
  }

  const clean = verbs.filter((v) => (PERMISSION_VERBS as string[]).includes(v));
  await prisma.companyPermissionDefault.upsert({
    where: { company_module: { company, module } },
    create: {
      company,
      module,
      verbs: clean,
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
    },
    update: {
      verbs: clean,
      updatedByUserId: viewer.id,
      updatedByName: viewer.name,
    },
  });
  return { ok: true, usersAffected };
}

/**
 * What a company default means for one role — the preview shown before saving.
 *
 * Computed against the role baseline so it states the real effect: a default
 * that removes something the role never had changes nothing, and says so.
 */
export function previewCompanyDefault(
  role: PlatformRoleValue,
  module: PlatformModule,
  verbs: PermissionVerb[],
): { before: PermissionVerb[]; after: PermissionVerb[] } {
  const baseline = PERMISSION_VERBS.filter((v) => permits(role, module, v));
  return { before: baseline, after: narrow(baseline, verbs) };
}
