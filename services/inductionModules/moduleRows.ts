import {
  getModule,
  listModules,
} from '@/services/inductionModules/inductionModuleService';
import { describeRealm } from '@/services/inductionModules/moduleActor';
import { formatDateUK } from '@/lib/datetime';
import type { ModuleRow } from '@/components/platform/InductionModulesSection';

/**
 * The company modules as the editor needs them, built ONCE for both front doors.
 *
 * Induction Videos and the Admin Centre render the same component over the same
 * data; if each page assembled its own rows, the two screens could show different
 * things about identical modules — which revision is in force, or whose words are
 * displayed when nothing is issued yet. That is the drift this whole design is
 * meant to prevent, so the assembly lives here and neither page does it.
 */
export async function moduleRowsForEditor(): Promise<ModuleRow[]> {
  const summaries = await listModules();
  return Promise.all(
    summaries.map(async (m) => {
      const full = await getModule(m.id);
      // The words in force, or the draft's when nothing is issued yet, so a
      // reader always sees what the module SAYS rather than an empty panel.
      const inForce =
        full?.revisions.find((r) => r.status === 'ISSUED') ??
        full?.revisions.find((r) => r.status === 'DRAFT') ??
        full?.revisions[0];
      return {
        id: m.id,
        slug: m.slug,
        title: m.title,
        category: m.category,
        mandatory: m.mandatory,
        defaultIncluded: m.defaultIncluded,
        active: m.active,
        replacesSceneType: m.replacesSceneType,
        issued: m.issued
          ? {
              version: m.issued.version,
              issuedOn: formatDateUK(m.issued.issuedAt),
              issuedByName: m.issued.issuedByName,
              issuedByRealm: describeRealm(m.issued.issuedByRealm),
            }
          : null,
        draft: m.draft,
        heading: inForce?.heading ?? m.title,
        narration: inForce?.narration ?? '',
        revisionCount: m.revisionCount,
      };
    }),
  );
}
