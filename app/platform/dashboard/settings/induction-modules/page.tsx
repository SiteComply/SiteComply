import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
import { InductionModulesSection } from '@/components/platform/InductionModulesSection';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canDraftInductionModule,
  canIssueInductionModule,
  getModule,
  listModules,
} from '@/services/inductionModules/inductionModuleService';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Company induction modules — standard content, written once.
 *
 * Sits beside Management arrangements because it is the same kind of thing:
 * organisational content a Director owns, inherited by every project, rather
 * than a per-site switch. Arrangements are inherited by the construction phase
 * plan; these are inherited by the induction.
 */
export default async function InductionModulesPage() {
  const viewer = await requirePlatformViewer();
  if (!viewer) notFound();

  const summaries = await listModules();
  // The words in force, for the list: the issued revision, or the draft when
  // nothing is issued yet, so a reader always sees what the module SAYS.
  const rows = await Promise.all(
    summaries.map(async (m) => {
      const full = await getModule(m.id);
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
            }
          : null,
        draft: m.draft,
        heading: inForce?.heading ?? m.title,
        narration: inForce?.narration ?? '',
        revisionCount: m.revisionCount,
      };
    }),
  );

  return (
    <PlatformShell>
      <SettingsWorkspace active="induction-modules">
        <InductionModulesSection
          modules={rows}
          canDraft={canDraftInductionModule(viewer.role)}
          canIssue={canIssueInductionModule(viewer.role)}
        />
      </SettingsWorkspace>
    </PlatformShell>
  );
}
