import { listModules } from '@/services/inductionModules/inductionModuleService';
import { moduleUsageSummaries } from '@/services/inductionModules/moduleUsage';
import { moduleStatus, type ModuleStatus } from '@/services/inductionModules/moduleStatus';
import { describeRealm } from '@/services/inductionModules/moduleActor';
import { formatDateUK } from '@/lib/datetime';
import { prisma } from '@/lib/prisma';

/**
 * THE COMPANY MODULES AS A LIST — built once for both front doors.
 *
 * ── WHAT CHANGED, AND WHY ─────────────────────────────────────────────────
 *
 * This used to return every module's full `narration` and `heading`, because the
 * landing page printed the wording of all of them: roughly 2,400 words before you
 * had clicked anything, with seven modules, growing with every module a company
 * adds. Fetching it also cost one query PER MODULE - `getModule` in a loop - to
 * read text the page did not need in order to help anybody choose a row.
 *
 * So the wording is gone from this shape entirely. It belongs to `moduleDetail`,
 * which loads one module when somebody asks for one. What a row carries instead is
 * what it takes to FIND the right module: its derived state, whether it reaches
 * anybody, how many projects get it, and what stands in for it.
 *
 * ── WHY THE ASSEMBLY IS SHARED ────────────────────────────────────────────
 *
 * Induction Videos and the Admin Centre render the same list over the same data. If
 * each page assembled its own rows the two screens could disagree about identical
 * modules - which revision is in force, or how many projects include one - and
 * nobody would see it, because the two are never read side by side.
 */

export interface ModuleRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  mandatory: boolean;
  defaultIncluded: boolean;
  active: boolean;
  /** Derived, never stored. See moduleStatus.ts. */
  status: ModuleStatus;
  /** The revision in force, for the row's secondary line. */
  issued: {
    version: number;
    issuedOn: string;
    issuedByName: string | null;
    issuedByRealm: string | null;
  } | null;
  draft: { id: string; version: number; preparedByName: string } | null;
  revisionCount: number;
  usage: { onProjects: number; totalProjects: number; excludedBy: number };
  /**
   * A library video that plays INSTEAD of this module's wording, if one is set. The
   * row has to say so: otherwise a module reads as reaching six projects when what
   * those projects actually show is somebody's film.
   */
  standsInFor: { assetId: string; title: string } | null;
  /** Left out of a project that records its own arrangement for this subject. */
  replacesSceneType: string | null;
}

export async function moduleRowsForIndex(): Promise<ModuleRow[]> {
  const [summaries, usage, libraryAssets] = await Promise.all([
    listModules(),
    moduleUsageSummaries(),
    // Which modules a library video displaces. One query, not one per module.
    prisma.libraryAsset.findMany({
      where: { moduleId: { not: null }, active: true },
      select: { id: true, title: true, moduleId: true },
    }),
  ]);
  const byModule = new Map(libraryAssets.map((a) => [a.moduleId as string, a]));

  return summaries.map((m) => {
    const asset = byModule.get(m.id);
    return {
      id: m.id,
      slug: m.slug,
      title: m.title,
      category: m.category,
      mandatory: m.mandatory,
      defaultIncluded: m.defaultIncluded,
      active: m.active,
      status: moduleStatus({
        active: m.active,
        issued: m.issued ? { version: m.issued.version } : null,
        draft: m.draft ? { version: m.draft.version } : null,
      }),
      issued: m.issued
        ? {
            version: m.issued.version,
            issuedOn: formatDateUK(m.issued.issuedAt),
            issuedByName: m.issued.issuedByName,
            issuedByRealm: describeRealm(m.issued.issuedByRealm),
          }
        : null,
      draft: m.draft,
      revisionCount: m.revisionCount,
      usage: {
        onProjects: usage.get(m.id)?.onProjects ?? 0,
        totalProjects: usage.get(m.id)?.totalProjects ?? 0,
        excludedBy: usage.get(m.id)?.excludedBy.length ?? 0,
      },
      standsInFor: asset ? { assetId: asset.id, title: asset.title } : null,
      replacesSceneType: m.replacesSceneType,
    };
  });
}
