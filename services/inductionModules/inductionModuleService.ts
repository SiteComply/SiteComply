import { createHash } from 'crypto';
import {
  InductionModuleRevisionStatus,
  SiteInductionModuleState,
  type InductionModuleCategory,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';
import { MODULE_CATALOGUE } from '@/services/inductionModules/moduleCatalogue';

/**
 * Company induction modules: the standard content every induction carries.
 *
 * ── DRAFT, ISSUED, SUPERSEDED — AND NOTHING OVERWRITTEN ───────────────────
 *
 * The same shape the construction phase plan uses, for the same reason: these
 * words are spoken to every operative on every site, and "what was the
 * manual-handling briefing this operative heard in July?" has to be answerable
 * years later. Editing in place would destroy that, which is why the CPP's
 * management arrangements - edited in place, and safe because the plan freezes
 * them in each revision - are NOT the model here.
 *
 * ── A DRAFT NEVER REACHES A SITE ──────────────────────────────────────────
 *
 * Only an ISSUED revision is inherited. A module whose first revision is still
 * being written is invisible to every induction, exactly as a draft CPP has no
 * PDF. That is what makes the seed set safe to ship: it arrives as drafts for a
 * Director to read.
 *
 * ── ISSUING IS DIRECTOR-ONLY ──────────────────────────────────────────────
 *
 * Stricter than approving one site's induction script, because this text goes
 * to every site at once.
 */

const DRAFT_ROLES: PlatformRoleValue[] = ['DIRECTOR', 'SITE_MANAGER'];

export function canDraftInductionModule(role: PlatformRoleValue): boolean {
  return DRAFT_ROLES.includes(role);
}

/** Issuing, and overriding at a site, are a Director's alone. */
export function canIssueInductionModule(role: PlatformRoleValue): boolean {
  return role === 'DIRECTOR';
}

export type ModuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function contentHash(heading: string, narration: string): string {
  return createHash('sha256')
    .update(`${heading.trim()}\n${narration.trim().replace(/\s+/g, ' ')}`)
    .digest('hex');
}

export interface ModuleSummary {
  id: string;
  slug: string;
  title: string;
  category: InductionModuleCategory;
  order: number;
  mandatory: boolean;
  defaultIncluded: boolean;
  replacesSceneType: string | null;
  active: boolean;
  /** The revision in force, if any. Null means this module reaches nobody. */
  issued: { id: string; version: number; issuedAt: Date; issuedByName: string | null } | null;
  /** An unissued revision being worked on, if any. */
  draft: { id: string; version: number; preparedByName: string } | null;
  revisionCount: number;
}

/** Every module, in the order they are spoken. */
export async function listModules(): Promise<ModuleSummary[]> {
  const rows = await prisma.inductionModule.findMany({
    orderBy: [{ active: 'desc' }, { order: 'asc' }],
    include: {
      revisions: { orderBy: { version: 'desc' } },
      _count: { select: { revisions: true } },
    },
  });

  return rows.map((m) => {
    const issued = m.revisions.find(
      (r) => r.status === InductionModuleRevisionStatus.ISSUED,
    );
    const draft = m.revisions.find(
      (r) => r.status === InductionModuleRevisionStatus.DRAFT,
    );
    return {
      id: m.id,
      slug: m.slug,
      title: m.title,
      category: m.category,
      order: m.order,
      mandatory: m.mandatory,
      defaultIncluded: m.defaultIncluded,
      replacesSceneType: m.replacesSceneType,
      active: m.active,
      issued:
        issued && issued.issuedAt
          ? {
              id: issued.id,
              version: issued.version,
              issuedAt: issued.issuedAt,
              issuedByName: issued.issuedByName,
            }
          : null,
      draft: draft
        ? { id: draft.id, version: draft.version, preparedByName: draft.preparedByName }
        : null,
      revisionCount: m._count.revisions,
    };
  });
}

/** One module in full, for the editor. */
export async function getModule(moduleId: string) {
  return prisma.inductionModule.findUnique({
    where: { id: moduleId },
    include: {
      revisions: {
        orderBy: { version: 'desc' },
        include: { events: { orderBy: { createdAt: 'desc' }, take: 20 } },
      },
    },
  });
}

async function record(
  revisionId: string,
  action: string,
  actorName: string,
  detail?: string,
): Promise<void> {
  await prisma.inductionModuleEvent.create({
    data: { revisionId, action, actorName, detail },
  });
}

/**
 * Start a new draft for a module.
 *
 * ONE DRAFT AT A TIME. A second concurrent draft would mean two people writing
 * different next versions with no way to say which is next; the existing draft
 * is returned instead so they meet in it.
 */
export async function startDraft(
  viewer: PlatformViewer,
  moduleId: string,
): Promise<ModuleResult<{ revisionId: string; version: number }>> {
  if (!canDraftInductionModule(viewer.role)) {
    return { ok: false, error: 'Only a Director or Site Manager may draft induction modules.' };
  }
  const module = await prisma.inductionModule.findUnique({
    where: { id: moduleId },
    include: { revisions: { orderBy: { version: 'desc' } } },
  });
  if (!module) return { ok: false, error: 'That module does not exist.' };

  const existing = module.revisions.find(
    (r) => r.status === InductionModuleRevisionStatus.DRAFT,
  );
  if (existing) {
    return { ok: true, value: { revisionId: existing.id, version: existing.version } };
  }

  // A new draft starts from the words currently in force, so a small correction
  // is a small edit rather than a retype.
  const source = module.revisions.find(
    (r) => r.status === InductionModuleRevisionStatus.ISSUED,
  ) ?? module.revisions[0];
  const version = (module.revisions[0]?.version ?? 0) + 1;

  const revision = await prisma.inductionModuleRevision.create({
    data: {
      moduleId,
      version,
      status: InductionModuleRevisionStatus.DRAFT,
      heading: source?.heading ?? module.title,
      narration: source?.narration ?? '',
      contentHash: contentHash(source?.heading ?? module.title, source?.narration ?? ''),
      preparedByUserId: viewer.id,
      preparedByName: viewer.name,
    },
    select: { id: true, version: true },
  });
  await record(revision.id, 'DRAFTED', viewer.name, `Version ${version}`);
  return { ok: true, value: { revisionId: revision.id, version: revision.version } };
}

/** Edit a draft. An issued revision can never be edited — it is superseded. */
export async function saveDraft(
  viewer: PlatformViewer,
  revisionId: string,
  input: { heading: string; narration: string },
): Promise<ModuleResult<{ saved: true }>> {
  if (!canDraftInductionModule(viewer.role)) {
    return { ok: false, error: 'Only a Director or Site Manager may draft induction modules.' };
  }
  const revision = await prisma.inductionModuleRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, status: true },
  });
  if (!revision) return { ok: false, error: 'That revision does not exist.' };
  if (revision.status !== InductionModuleRevisionStatus.DRAFT) {
    return {
      ok: false,
      error: 'An issued revision cannot be edited. Start a new draft instead.',
    };
  }

  const heading = input.heading.trim();
  const narration = input.narration.trim();
  if (heading.length < 3) return { ok: false, error: 'Give the module a heading.' };
  if (narration.length < 40) {
    return { ok: false, error: 'The narration is too short to be a briefing.' };
  }
  /*
   * The same ceiling the speech service enforces per scene. Caught here so a
   * Director learns it while writing, rather than when a site's narration job
   * fails hours later.
   */
  if (narration.length > 3_000) {
    return { ok: false, error: 'The narration is too long to be spoken as one scene.' };
  }

  await prisma.inductionModuleRevision.update({
    where: { id: revisionId },
    data: { heading, narration, contentHash: contentHash(heading, narration) },
  });
  await record(revisionId, 'EDITED', viewer.name);
  return { ok: true, value: { saved: true } };
}

/**
 * Issue a draft: it becomes the version in force, and the previous one becomes
 * history.
 *
 * Supersede and issue happen in ONE transaction, so two revisions of a module
 * can never both be in force.
 */
export async function issueRevision(
  viewer: PlatformViewer,
  revisionId: string,
  issueNote: string,
): Promise<ModuleResult<{ version: number }>> {
  if (!canIssueInductionModule(viewer.role)) {
    return { ok: false, error: 'Only a Director may issue an induction module.' };
  }
  const revision = await prisma.inductionModuleRevision.findUnique({
    where: { id: revisionId },
    include: { module: { select: { id: true, title: true, active: true } } },
  });
  if (!revision) return { ok: false, error: 'That revision does not exist.' };
  if (revision.status !== InductionModuleRevisionStatus.DRAFT) {
    return { ok: false, error: 'Only a draft can be issued.' };
  }
  if (revision.narration.trim().length < 40) {
    return { ok: false, error: 'The narration is too short to be issued.' };
  }
  const note = issueNote.trim();
  if (note.length < 5) {
    return { ok: false, error: 'Say what changed in this revision.' };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.inductionModuleRevision.updateMany({
      where: {
        moduleId: revision.module.id,
        status: InductionModuleRevisionStatus.ISSUED,
      },
      data: { status: InductionModuleRevisionStatus.SUPERSEDED, supersededAt: now },
    }),
    prisma.inductionModuleRevision.update({
      where: { id: revisionId },
      data: {
        status: InductionModuleRevisionStatus.ISSUED,
        issuedAt: now,
        issuedByUserId: viewer.id,
        issuedByName: viewer.name,
        issueNote: note,
      },
    }),
    prisma.inductionModuleEvent.create({
      data: {
        revisionId,
        action: 'ISSUED',
        actorName: viewer.name,
        detail: `Version ${revision.version} · ${note}`,
      },
    }),
  ]);
  return { ok: true, value: { version: revision.version } };
}

/**
 * Stop a module being included anywhere, without deleting anything.
 *
 * DEACTIVATED, NEVER DELETED. A published induction video carries the words an
 * operative was shown; deleting the module they came from would leave that
 * record pointing at nothing.
 */
export async function setModuleActive(
  viewer: PlatformViewer,
  moduleId: string,
  active: boolean,
): Promise<ModuleResult<{ active: boolean }>> {
  if (!canIssueInductionModule(viewer.role)) {
    return { ok: false, error: 'Only a Director may retire an induction module.' };
  }
  const module = await prisma.inductionModule.findUnique({
    where: { id: moduleId },
    select: { id: true, mandatory: true },
  });
  if (!module) return { ok: false, error: 'That module does not exist.' };
  if (module.mandatory && !active) {
    return {
      ok: false,
      error:
        'This module is mandatory for every site. Make it optional before retiring it.',
    };
  }
  await prisma.inductionModule.update({ where: { id: moduleId }, data: { active } });
  return { ok: true, value: { active } };
}

/** Change how a module behaves, without touching its words. */
export async function updateModuleSettings(
  viewer: PlatformViewer,
  moduleId: string,
  input: { mandatory?: boolean; defaultIncluded?: boolean; order?: number },
): Promise<ModuleResult<{ saved: true }>> {
  if (!canIssueInductionModule(viewer.role)) {
    return { ok: false, error: 'Only a Director may change how a module applies.' };
  }
  const module = await prisma.inductionModule.findUnique({
    where: { id: moduleId },
    select: { id: true },
  });
  if (!module) return { ok: false, error: 'That module does not exist.' };

  await prisma.inductionModule.update({
    where: { id: moduleId },
    data: {
      ...(input.mandatory === undefined ? {} : { mandatory: input.mandatory }),
      ...(input.defaultIncluded === undefined
        ? {}
        : { defaultIncluded: input.defaultIncluded }),
      ...(input.order === undefined ? {} : { order: input.order }),
      // A mandatory module is always included; the two settings cannot disagree.
      ...(input.mandatory === true ? { defaultIncluded: true } : {}),
    },
  });
  return { ok: true, value: { saved: true } };
}

/* ─────────────────── what a site actually gets (Phase B reads this) ───── */

export interface ResolvedModule {
  moduleId: string;
  slug: string;
  title: string;
  order: number;
  mandatory: boolean;
  /** The revision whose words are in force. */
  revisionId: string;
  version: number;
  heading: string;
  narration: string;
  replacesSceneType: string | null;
  /** True when this project has departed from the company text. */
  overridden: boolean;
  overrideReason: string | null;
}

/**
 * The modules one project's induction should carry, and their words.
 *
 * THE RESOLUTION RULE LIVES ONLY HERE — a site row wins, else the module's
 * default, else it is not included — so the settings screen, the site screen
 * and the generated video cannot disagree about what is in force. The same
 * arrangement `resolveArrangements` makes for the construction phase plan.
 *
 * A module with no ISSUED revision is invisible: a draft never reaches a site.
 */
export async function resolveModulesForSite(siteId: string): Promise<ResolvedModule[]> {
  const [modules, siteRows] = await Promise.all([
    prisma.inductionModule.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      include: {
        revisions: {
          where: { status: InductionModuleRevisionStatus.ISSUED },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.siteInductionModule.findMany({ where: { jobSiteId: siteId } }),
  ]);
  const decisions = new Map(siteRows.map((r) => [r.moduleId, r]));

  const resolved: ResolvedModule[] = [];
  for (const m of modules) {
    const issued = m.revisions[0];
    if (!issued) continue; // a draft never reaches a site

    const decision = decisions.get(m.id);
    const excluded =
      decision?.state === SiteInductionModuleState.EXCLUDED && !m.mandatory;
    if (excluded) continue;
    if (!decision && !m.defaultIncluded) continue;

    const overridden =
      decision?.state === SiteInductionModuleState.OVERRIDDEN &&
      Boolean(decision.overrideNarration?.trim());

    resolved.push({
      moduleId: m.id,
      slug: m.slug,
      title: m.title,
      order: m.order,
      mandatory: m.mandatory,
      revisionId: issued.id,
      version: issued.version,
      heading: issued.heading,
      narration: overridden ? decision!.overrideNarration!.trim() : issued.narration,
      replacesSceneType: m.replacesSceneType,
      overridden,
      overrideReason: overridden ? decision!.reason ?? null : null,
    });
  }
  return resolved;
}

/* ───────────────────────────── the seed set ───────────────────────────── */

export interface SeedResult {
  created: number;
  skipped: number;
}

/**
 * Create the starter modules, as DRAFTS.
 *
 * Idempotent by slug: running it twice adds nothing. Seeding as drafts rather
 * than issued content is the whole point - nobody's induction gains words a
 * Director has not read.
 */
export async function seedModuleCatalogue(actorName = 'SiteComply'): Promise<SeedResult> {
  let created = 0;
  let skipped = 0;

  for (const entry of MODULE_CATALOGUE) {
    const existing = await prisma.inductionModule.findUnique({
      where: { slug: entry.slug },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    const module = await prisma.inductionModule.create({
      data: {
        slug: entry.slug,
        title: entry.title,
        category: entry.category,
        order: entry.order,
        mandatory: entry.mandatory,
        defaultIncluded: entry.defaultIncluded,
        replacesSceneType: entry.replacesSceneType ?? null,
        createdByName: actorName,
      },
      select: { id: true },
    });
    const revision = await prisma.inductionModuleRevision.create({
      data: {
        moduleId: module.id,
        version: 1,
        status: InductionModuleRevisionStatus.DRAFT,
        heading: entry.heading,
        narration: entry.narration,
        contentHash: contentHash(entry.heading, entry.narration),
        preparedByName: actorName,
      },
      select: { id: true },
    });
    await record(
      revision.id,
      'DRAFTED',
      actorName,
      'Suggested starting wording — read it, change what does not match how this company works, then issue it.',
    );
    created++;
  }
  return { created, skipped };
}
