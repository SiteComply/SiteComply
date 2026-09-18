import { ArrangementKey } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import {
  CPP_ARRANGEMENTS,
  isArrangementKey,
  type ArrangementKeyValue,
  type ArrangementSource,
} from '@/services/sites/cppArrangements';

/**
 * CPP Tier 3A — management arrangements, resolved.
 *
 * Company standard, inherited by every site, overridden per site where the site
 * genuinely differs. See cppArrangements for why this is company-level.
 *
 * THE RESOLUTION RULE IS ONE LINE and lives only here: a site override if there
 * is one, otherwise the company standard, otherwise nothing. Every screen and
 * the printed plan read it through `resolveArrangements`, so the editor and the
 * document cannot disagree about which text is in force.
 */

export interface ResolvedArrangement {
  key: ArrangementKeyValue;
  title: string;
  purpose: string;
  guidance: string;
  promptSiteSpecific: boolean;
  /** The text actually in force for this site. */
  content: string | null;
  /** Where that text came from. Printed in the plan. */
  source: ArrangementSource;
  /** The company text, so the editor can show what an override replaced. */
  standardContent: string | null;
}

const MAX_CONTENT = 8000;

const clean = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** The company-level arrangements, keyed. Used by the settings editor. */
export async function getStandardArrangements(): Promise<
  Record<string, string | null>
> {
  const rows = await prisma.standardArrangement.findMany({
    select: { key: true, content: true },
  });
  const out: Record<string, string | null> = {};
  for (const a of CPP_ARRANGEMENTS) out[a.key] = null;
  for (const r of rows) out[String(r.key)] = clean(r.content);
  return out;
}

/**
 * Every arrangement as it stands for one site, in plan order.
 *
 * Always returns all six, whether or not anything has been written. An
 * arrangement nobody has authored is `source: 'NONE'` and prints as not
 * recorded — the same rule the rest of the plan follows, because a silent
 * omission is worse than a stated gap.
 */
export async function resolveArrangements(
  siteId: string,
): Promise<ResolvedArrangement[]> {
  const [standards, overrides] = await Promise.all([
    prisma.standardArrangement.findMany({ select: { key: true, content: true } }),
    prisma.siteArrangement.findMany({
      where: { jobSiteId: siteId },
      select: { key: true, content: true },
    }),
  ]);
  const std = new Map(standards.map((r) => [String(r.key), clean(r.content)]));
  const site = new Map(overrides.map((r) => [String(r.key), clean(r.content)]));

  return CPP_ARRANGEMENTS.map((a) => {
    const siteText = site.get(a.key) ?? null;
    const stdText = std.get(a.key) ?? null;
    // A site row whose content is blank is treated as no override rather than as
    // an empty override, so clearing the box cannot silently blank the plan.
    const content = siteText ?? stdText;
    const source: ArrangementSource = siteText
      ? 'SITE'
      : stdText
        ? 'STANDARD'
        : 'NONE';
    return {
      key: a.key,
      title: a.title,
      purpose: a.purpose,
      guidance: a.guidance,
      promptSiteSpecific: a.promptSiteSpecific,
      content,
      source,
      standardContent: stdText,
    };
  });
}

export type ArrangementSaveResult = { ok: true } | { ok: false; error: string };

/**
 * Write a company standard.
 *
 * DIRECTOR-LEVEL. These are organisational policy applying to every project, so
 * they follow `canEditSite` — the same gate the project-level setup steps use —
 * rather than `sites:edit`, which Site Managers hold. A site manager can write an
 * override for their own site; they cannot rewrite company policy for everyone.
 */
export async function saveStandardArrangement(
  viewer: PlatformViewer,
  key: string,
  content: string | null,
): Promise<ArrangementSaveResult> {
  if (!canEditSite(viewer.role)) {
    return { ok: false, error: 'Only a Director can edit company arrangements.' };
  }
  if (!isArrangementKey(key)) {
    return { ok: false, error: 'Unknown arrangement.' };
  }
  const text = clean(content)?.slice(0, MAX_CONTENT) ?? null;
  const k = key as ArrangementKey;

  if (text === null) {
    // Clearing removes the row: "not recorded" is one state, not an empty string
    // that would print as a blank section.
    await prisma.standardArrangement.deleteMany({ where: { key: k } });
    return { ok: true };
  }
  const stamp = { updatedByUserId: viewer.id, updatedByName: viewer.name };
  await prisma.standardArrangement.upsert({
    where: { key: k },
    update: { content: text, ...stamp },
    create: { key: k, content: text, ...stamp },
  });
  return { ok: true };
}

/**
 * Write or remove a site override.
 *
 * ABSENT MEANS INHERIT, so removing an override is a delete. There is no
 * "usesDefault" flag to fall out of step with the content.
 */
export async function saveSiteArrangement(
  viewer: PlatformViewer,
  siteId: string,
  key: string,
  content: string | null,
): Promise<ArrangementSaveResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, error: 'You cannot configure this site.' };
  }
  if (!viewer.siteIds.includes(siteId)) {
    return { ok: false, error: 'Site not found.' };
  }
  if (!isArrangementKey(key)) {
    return { ok: false, error: 'Unknown arrangement.' };
  }
  const text = clean(content)?.slice(0, MAX_CONTENT) ?? null;
  const k = key as ArrangementKey;

  if (text === null) {
    await prisma.siteArrangement.deleteMany({
      where: { jobSiteId: siteId, key: k },
    });
    return { ok: true };
  }
  const stamp = { updatedByUserId: viewer.id, updatedByName: viewer.name };
  await prisma.siteArrangement.upsert({
    where: { jobSiteId_key: { jobSiteId: siteId, key: k } },
    update: { content: text, ...stamp },
    create: { jobSiteId: siteId, key: k, content: text, ...stamp },
  });
  return { ok: true };
}
