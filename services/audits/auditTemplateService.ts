import { FindingCategory, FindingSeverity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canManageAuditTemplates,
} from '@/services/platformUsers/platformPermissions';
import {
  TEMPLATE_NAME_MAX,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_ITEM_LABEL_MAX,
  TEMPLATE_ITEM_HELP_MAX,
  TEMPLATE_MAX_ITEMS,
} from '@/services/audits/auditTemplateConstants';

/**
 * Audit Template library (SC-013). Organisation-level (NOT site-scoped): a
 * reusable library of audit formats that standardises audits across sites. Any
 * audit-creating role may list/use templates and save a new one; editing/deleting
 * a SHARED template is restricted (canManageAuditTemplates) so one manager can't
 * break an org-wide format. Templates are versioned for provenance; because an
 * audit copies items at creation (auditService.createAudit), template edits never
 * alter historic audits.
 */

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  version: number;
  active: boolean;
  isSystem: boolean;
  itemCount: number;
}

export interface TemplateItem {
  label: string;
  helpText: string | null;
  category: FindingCategory;
  defaultSeverity: FindingSeverity | null;
}

export interface TemplateDetail extends TemplateSummary {
  items: TemplateItem[];
}

/** Active templates for the "create from template" picker (org-wide). */
export async function listActiveTemplates(): Promise<TemplateSummary[]> {
  const rows = await prisma.auditTemplate.findMany({
    where: { active: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { items: true } } },
  });
  return rows.map(toSummary);
}

/** All templates for the library admin (includes inactive). */
export async function listAllTemplates(): Promise<TemplateSummary[]> {
  const rows = await prisma.auditTemplate.findMany({
    orderBy: [{ active: 'desc' }, { order: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { items: true } } },
  });
  return rows.map(toSummary);
}

function toSummary(r: {
  id: string;
  name: string;
  description: string | null;
  version: number;
  active: boolean;
  isSystem: boolean;
  _count: { items: number };
}): TemplateSummary {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    version: r.version,
    active: r.active,
    isSystem: r.isSystem,
    itemCount: r._count.items,
  };
}

export async function getTemplate(id: string): Promise<TemplateDetail | null> {
  const t = await prisma.auditTemplate.findUnique({
    where: { id },
    include: {
      items: { orderBy: { order: 'asc' } },
      _count: { select: { items: true } },
    },
  });
  if (!t) return null;
  return {
    ...toSummary(t),
    items: t.items.map((it) => ({
      label: it.label,
      helpText: it.helpText,
      category: it.category,
      defaultSeverity: it.defaultSeverity,
    })),
  };
}

export interface TemplateInput {
  name?: string;
  description?: string;
  items?: {
    label?: string;
    helpText?: string;
    category?: string;
    defaultSeverity?: string | null;
  }[];
}

export type TemplateResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid';
      error?: string;
    };

function cleanItems(raw: TemplateInput['items']): TemplateItem[] {
  const cats = Object.values(FindingCategory) as string[];
  const sevs = Object.values(FindingSeverity) as string[];
  return (raw ?? [])
    .map((it) => ({
      label: (it.label ?? '').trim().slice(0, TEMPLATE_ITEM_LABEL_MAX),
      helpText: it.helpText?.trim().slice(0, TEMPLATE_ITEM_HELP_MAX) || null,
      category: (cats.includes(it.category ?? '')
        ? it.category
        : 'OTHER') as FindingCategory,
      defaultSeverity: (it.defaultSeverity && sevs.includes(it.defaultSeverity)
        ? it.defaultSeverity
        : null) as FindingSeverity | null,
    }))
    .filter((it) => it.label.length > 0)
    .slice(0, TEMPLATE_MAX_ITEMS);
}

/** Create a brand-new template (any audit-creating role). */
export async function createTemplate(
  viewer: PlatformViewer,
  input: TemplateInput,
): Promise<TemplateResult> {
  if (!permits(viewer.role, 'audits', 'create')) {
    return { ok: false, reason: 'forbidden' };
  }
  const name = (input.name ?? '').trim().slice(0, TEMPLATE_NAME_MAX);
  if (name.length < 2)
    return { ok: false, reason: 'invalid', error: 'A name is required.' };
  const items = cleanItems(input.items);
  if (items.length === 0) {
    return { ok: false, reason: 'invalid', error: 'Add at least one item.' };
  }
  const created = await prisma.auditTemplate.create({
    data: {
      name,
      description:
        input.description?.trim().slice(0, TEMPLATE_DESCRIPTION_MAX) || null,
      isSystem: false,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      items: { create: items.map((it, i) => ({ ...it, order: i })) },
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/**
 * Save an existing audit as a reusable template (any audit-creating role, audit
 * in scope). Captures the audit's checklist items; if it has none, derives items
 * from its findings.
 */
export async function saveAuditAsTemplate(
  viewer: PlatformViewer,
  auditId: string,
  name: string,
): Promise<TemplateResult> {
  if (!permits(viewer.role, 'audits', 'create')) {
    return { ok: false, reason: 'forbidden' };
  }
  const audit = await prisma.audit.findFirst({
    where: { id: auditId, jobSiteId: { in: viewer.siteIds } },
    include: {
      items: { orderBy: { order: 'asc' } },
      findings: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!audit) return { ok: false, reason: 'not_found' };

  const cleanName = (name ?? '').trim().slice(0, TEMPLATE_NAME_MAX);
  if (cleanName.length < 2) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'A template name is required.',
    };
  }

  const items: TemplateItem[] =
    audit.items.length > 0
      ? audit.items.map((it) => ({
          label: it.label,
          helpText: it.helpText,
          category: it.category,
          defaultSeverity: null,
        }))
      : audit.findings.map((f) => ({
          label: f.title,
          helpText: null,
          category: f.category,
          defaultSeverity: f.severity,
        }));
  if (items.length === 0) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'This audit has no items or findings to save as a template.',
    };
  }

  const created = await prisma.auditTemplate.create({
    data: {
      name: cleanName,
      description:
        audit.description?.slice(0, TEMPLATE_DESCRIPTION_MAX) || null,
      isSystem: false,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
      items: {
        create: items
          .slice(0, TEMPLATE_MAX_ITEMS)
          .map((it, i) => ({ ...it, order: i })),
      },
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/** Edit a shared template (restricted). Bumps the version for provenance. */
export async function updateTemplate(
  viewer: PlatformViewer,
  id: string,
  input: TemplateInput,
): Promise<TemplateResult> {
  if (!canManageAuditTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const existing = await prisma.auditTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };
  const name = (input.name ?? '').trim().slice(0, TEMPLATE_NAME_MAX);
  if (name.length < 2)
    return { ok: false, reason: 'invalid', error: 'A name is required.' };
  const items = cleanItems(input.items);
  if (items.length === 0) {
    return { ok: false, reason: 'invalid', error: 'Add at least one item.' };
  }
  await prisma.$transaction([
    prisma.auditTemplateItem.deleteMany({ where: { templateId: id } }),
    prisma.auditTemplate.update({
      where: { id },
      data: {
        name,
        description:
          input.description?.trim().slice(0, TEMPLATE_DESCRIPTION_MAX) || null,
        version: { increment: 1 },
        items: { create: items.map((it, i) => ({ ...it, order: i })) },
      },
    }),
  ]);
  return { ok: true, id };
}

/** Activate / deactivate a template (restricted). */
export async function setTemplateActive(
  viewer: PlatformViewer,
  id: string,
  active: boolean,
): Promise<TemplateResult> {
  if (!canManageAuditTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const t = await prisma.auditTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!t) return { ok: false, reason: 'not_found' };
  await prisma.auditTemplate.update({ where: { id }, data: { active } });
  return { ok: true, id };
}

/** Delete a template (restricted; system starters can't be deleted). */
export async function deleteTemplate(
  viewer: PlatformViewer,
  id: string,
): Promise<TemplateResult> {
  if (!canManageAuditTemplates(viewer.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  const t = await prisma.auditTemplate.findUnique({
    where: { id },
    select: { id: true, isSystem: true },
  });
  if (!t) return { ok: false, reason: 'not_found' };
  if (t.isSystem) {
    return {
      ok: false,
      reason: 'invalid',
      error: 'Starter templates can’t be deleted — deactivate them instead.',
    };
  }
  await prisma.auditTemplate.delete({ where: { id } });
  return { ok: true, id };
}
