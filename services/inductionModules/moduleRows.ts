import { listModules } from '@/services/inductionModules/inductionModuleService';
import { moduleUsageSummaries } from '@/services/inductionModules/moduleUsage';
import { moduleStatus, type ModuleStatus } from '@/services/inductionModules/moduleStatus';
import { describeRealm } from '@/services/inductionModules/moduleActor';
import { formatDateUK } from '@/lib/datetime';
import { moduleVideoStages } from '@/services/inductionVideo/moduleVideoStage';
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
  /**
   * How far this module's VIDEO has got, as one step of eight. On the list so the
   * workflow's state is visible without opening every module — the old index said
   * nothing about video at all, so "which of these still needs finishing?" could
   * only be answered by clicking through them one at a time.
   */
  video: { step: number; label: string; working: boolean; live: boolean };
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

/**
 * WHAT THE PRIMARY MODULES PAGE GETS.
 *
 * ── RETIRED MODULES ARE NOT IN IT ─────────────────────────────────────────
 *
 * They used to be, hidden behind a "Show retired" checkbox. By the owner's decision
 * Company Modules is the ACTIVE catalogue - the content that can actually reach a new
 * induction - and retired content lives in its own archive. So this returns active
 * rows only, and the page cannot show a retired module even by mistake, because the
 * data is not there. A component-level filter would have left the rows one boolean
 * away from being rendered.
 *
 * What it still needs to KNOW about retired modules, without showing them:
 *   the COUNT, so it can link to the archive honestly;
 *   the SLUGS, so a retired standard module does not read as "missing" and get
 *   offered for creation - it exists, it is just archived.
 */
export interface ModuleIndex {
  rows: ModuleRow[];
  retired: { count: number; slugs: string[] };
}

/**
 * The row's view of a video stage. One shaper, so the index and the archive cannot
 * describe the same absence differently.
 */
function stageRow(v: { step: number; label: string; working: boolean; live: boolean } | undefined) {
  return {
    step: v?.step ?? 1,
    label: v?.label ?? 'Write wording',
    working: v?.working ?? false,
    live: v?.live ?? false,
  };
}

export async function moduleRowsForIndex(): Promise<ModuleIndex> {
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

  /*
   * The video stage per ACTIVE module. Retired ones are not offered a video, so there
   * is nothing to say about them and no reason to pay for the queries.
   */
  const stages = await moduleVideoStages(
    summaries.filter((m) => m.active).map((m) => m.id),
  );

  const retired = summaries.filter((m) => !m.active);
  const toRow = (m: (typeof summaries)[number]): ModuleRow => {
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
      video: stageRow(stages.get(m.id)),
    };
  };

  return {
    rows: summaries.filter((m) => m.active).map(toRow),
    retired: { count: retired.length, slugs: retired.map((m) => m.slug) },
  };
}

/**
 * THE ARCHIVE: modules that have been retired.
 *
 * The same row shape, so the archive can show the same facts without a second
 * assembly to keep in step. Usage figures are included and will read zero, which is
 * the honest answer - a retired module reaches nobody, and saying so beats hiding the
 * column.
 *
 * There is no "retired on" date, deliberately: `setModuleActive` records no event, so
 * any date here would be `updatedAt` - which moves when somebody changes a setting -
 * dressed up as a retirement date. Better to show nothing than something wrong.
 */
export async function retiredModuleRows(): Promise<ModuleRow[]> {
  const index = await moduleRowsForIndexAll();
  return index.filter((m) => !m.active);
}

/** Every module as a row, active or not. Used by the archive and by nothing else. */
async function moduleRowsForIndexAll(): Promise<ModuleRow[]> {
  const [summaries, usage, libraryAssets] = await Promise.all([
    listModules(),
    moduleUsageSummaries(),
    prisma.libraryAsset.findMany({
      where: { moduleId: { not: null }, active: true },
      select: { id: true, title: true, moduleId: true },
    }),
  ]);
  const byModule = new Map(libraryAssets.map((a) => [a.moduleId as string, a]));
  return summaries.map((m) => ({
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
    standsInFor: byModule.get(m.id)
      ? { assetId: byModule.get(m.id)!.id, title: byModule.get(m.id)!.title }
      : null,
    replacesSceneType: m.replacesSceneType,
    // No stage is computed here: this feeds the archive, and a retired module is
    // offered no video at all, so there is nothing to report and nothing to query for.
    video: stageRow(undefined),
  }));
}
