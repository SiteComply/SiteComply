import { listLibraryAssets } from '@/services/inductionVideo/libraryAssetService';
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
  modules: { id: string; title: string }[];
}> {
  const [assets, modules] = await Promise.all([listLibraryAssets(), listModules()]);
  return {
    assets: assets.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      description: a.description,
      placement: a.placement,
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
    // Only issued modules can be stood in for: an unissued one reaches nobody, so
    // there would be nothing to replace.
    modules: modules.filter((m) => m.issued).map((m) => ({ id: m.id, title: m.title })),
  };
}
