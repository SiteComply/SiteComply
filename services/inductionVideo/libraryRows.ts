import { listLibraryAssets } from '@/services/inductionVideo/libraryAssetService';
import { libraryStatus } from '@/services/inductionVideo/libraryStatus';
import { libraryUsageSummaries } from '@/services/inductionVideo/libraryUsage';
import { listModules } from '@/services/inductionModules/inductionModuleService';
import { describeRealm } from '@/services/inductionModules/moduleActor';
import { formatRunningTime } from '@/services/inductionVideo/captions';
import { formatDateUK } from '@/lib/datetime';
import type { LibraryRow } from '@/components/inductionVideo/LibrarySection';

/**
 * The library as the editor needs it, built ONCE for both tiers.
 *
 * Same reasoning as `moduleRowsForEditor`: if each tier assembled its own rows the
 * two screens could disagree about which revision is in force or what a draft is
 * still waiting for, and that drift is the thing the shared definition exists to
 * prevent.
 */
export async function libraryRowsForEditor(): Promise<{
  assets: LibraryRow[];
  modules: {
    id: string;
    title: string;
    slug: string;
    category: string;
    /** Has issued wording, so a video can actually be produced from it. */
    hasIssued: boolean;
  }[];
  totalProjects: number;
}> {
  const [assets, modules, usage] = await Promise.all([
    listLibraryAssets(),
    listModules(),
    libraryUsageSummaries(),
  ]);
  return {
    totalProjects: usage.totalProjects,
    assets: assets.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      description: a.description,
      placement: a.placement,
      category: a.category,
      provenance: a.provenance,
      // Derived here so the index and the detail page cannot phrase the same state
      // in two different ways.
      status: libraryStatus({
        active: a.active,
        issued: a.issued ? { version: a.issued.version } : null,
        draft: a.draft
          ? {
              version: a.draft.version,
              hasFootage: a.draft.readiness.hasFootage,
              normalised: a.draft.readiness.normalised,
              hasCaptions: a.draft.readiness.hasCaptions,
              normaliseError: a.draft.normaliseError,
            }
          : null,
      }),
      usage: usage.byAsset.get(a.id) ?? {
        assetId: a.id, onProjects: 0, publishedInductions: 0,
      },
      mandatory: a.mandatory,
      defaultIncluded: a.defaultIncluded,
      active: a.active,
      moduleTitle: a.moduleTitle,
      issued: a.issued
        ? {
            version: a.issued.version,
            issuedOn: formatDateUK(a.issued.issuedAt),
            issuedByName: a.issued.issuedByName,
            issuedByRealm: describeRealm(a.issued.issuedByRealm),
            durationLabel: a.issued.durationMs ? formatRunningTime(a.issued.durationMs) : null,
          }
        : null,
      draft: a.draft
        ? {
            id: a.draft.id,
            version: a.draft.version,
            preparedByName: a.draft.preparedByName,
            ready: a.draft.readiness.ready,
            missing: a.draft.readiness.missing,
            normaliseError: a.draft.normaliseError,
          }
        : null,
      revisionCount: a.revisionCount,
    })),
    /*
     * EVERY MODULE, WITH ITS READINESS — not only the issued ones.
     *
     * This filtered to issued modules, and the effect was a silent dead end: a user
     * creating a "Company introduction" video saw a picker offering only "PPE
     * expectations", with nothing to say that the module they wanted existed as a
     * draft three clicks away. The obvious next move was to pick PPE and produce a
     * company introduction made of PPE content.
     *
     * A module with no issued wording still cannot produce a video - the generation
     * step refuses, and rightly. But it should be VISIBLE and marked, because
     * "issue that module first" is a useful instruction and an absence is not.
     */
    modules: modules.map((m) => ({
      id: m.id,
      title: m.title,
      slug: m.slug,
      category: m.category as string,
      hasIssued: Boolean(m.issued),
    })),
  };
}
