import { prisma } from '@/lib/prisma';
import { moduleReachesSite } from '@/services/inductionModules/inductionModuleService';

/**
 * WHERE EACH COMPANY MODULE ACTUALLY REACHES — counted, for the list.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The modules landing page used to print every module's whole narration, which
 * told you what a module SAYS and nothing about whether anybody hears it. Moving
 * the wording to a detail page leaves a row that has to earn its place in one
 * line: what state it is in, and who gets it. This is the second half.
 *
 * ── IT ASKS THE SERVICE'S OWN PREDICATE ───────────────────────────────────
 *
 * `moduleReachesSite` is the rule `resolveModulesForSite` uses to build a real
 * induction. Counting with a second copy of those conditions is how a list ends up
 * claiming a module reaches a project whose induction leaves it out - and nobody
 * would notice, because the two screens are never read side by side.
 *
 * ── ONE QUERY PER TABLE, NOT PER MODULE ───────────────────────────────────
 *
 * Seven modules across six projects is 42 combinations; the loader this replaces
 * already ran one query PER module just to fetch narration for the page. Three
 * queries total, whatever the counts grow to.
 */

export interface ModuleUsage {
  /** Active projects whose next induction includes this module. */
  onProjects: number;
  /** Active projects in total, so "3" can be read as "3 of 6". */
  totalProjects: number;
  /** Projects that have deliberately left it out, named so the decision is checkable. */
  excludedBy: { siteId: string; siteName: string }[];
  /** Projects that have recorded their own wording in its place. */
  overriddenBy: { siteId: string; siteName: string }[];
}

/**
 * Usage for every module at once, keyed by module id.
 *
 * A module with no issued revision reaches nobody whatever the decisions say, so it
 * is counted as zero rather than left out of the map - a row still needs a figure
 * to show.
 */
export async function moduleUsageSummaries(): Promise<Map<string, ModuleUsage>> {
  const [modules, sites, decisions] = await Promise.all([
    prisma.inductionModule.findMany({
      select: {
        id: true,
        mandatory: true,
        defaultIncluded: true,
        active: true,
        revisions: {
          where: { status: 'ISSUED' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    }),
    /*
     * ACTIVE projects only, matching `libraryUsage` exactly: a module is not
     * "missing from" a project that is archived or formally closed. SiteStatus has
     * three values and only one of them is a project anybody is still inducting
     * for, so this is `status: 'ACTIVE'` and never a negation.
     */
    prisma.jobSite.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } }),
    prisma.siteInductionModule.findMany({
      select: {
        moduleId: true,
        jobSiteId: true,
        state: true,
        overrideNarration: true,
      },
    }),
  ]);

  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  // moduleId -> siteId -> decision, so the inner lookup is by key rather than a scan.
  const byModule = new Map<string, Map<string, (typeof decisions)[number]>>();
  for (const d of decisions) {
    if (!siteName.has(d.jobSiteId)) continue; // a decision on a closed project
    const forModule = byModule.get(d.moduleId) ?? new Map();
    forModule.set(d.jobSiteId, d);
    byModule.set(d.moduleId, forModule);
  }

  const out = new Map<string, ModuleUsage>();
  for (const m of modules) {
    const issued = m.revisions[0];
    const forModule = byModule.get(m.id) ?? new Map();
    const excludedBy: { siteId: string; siteName: string }[] = [];
    const overriddenBy: { siteId: string; siteName: string }[] = [];
    let onProjects = 0;

    for (const site of sites) {
      const decision = forModule.get(site.id) ?? null;
      /*
       * A RETIRED MODULE AND A DRAFT BOTH REACH NOBODY, and both are decided before
       * the per-site rule is consulted - `resolveModulesForSite` filters on
       * `active: true` in its query and returns early when there is no issued
       * revision, so the predicate never sees either case.
       */
      const reaches = Boolean(issued) && m.active && moduleReachesSite(m, decision);
      if (reaches) onProjects += 1;

      if (decision?.state === 'EXCLUDED' && !m.mandatory) {
        excludedBy.push({ siteId: site.id, siteName: site.name });
      }
      if (decision?.state === 'OVERRIDDEN' && decision.overrideNarration?.trim()) {
        overriddenBy.push({ siteId: site.id, siteName: site.name });
      }
    }

    out.set(m.id, {
      onProjects,
      totalProjects: sites.length,
      excludedBy,
      overriddenBy,
    });
  }
  return out;
}

/** One module's usage, for its detail page. */
export async function moduleUsage(moduleId: string): Promise<ModuleUsage> {
  const all = await moduleUsageSummaries();
  return (
    all.get(moduleId) ?? {
      onProjects: 0,
      totalProjects: 0,
      excludedBy: [],
      overriddenBy: [],
    }
  );
}
