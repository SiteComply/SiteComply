import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import {
  InductionVideoWorkspace,
  INDUCTION_VIDEO_AREAS,
} from '@/components/platform/InductionVideoWorkspace';
import { InductionModulesSection } from '@/components/platform/InductionModulesSection';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canDraftInductionModule,
  canIssueInductionModule,
  canViewInductionModules,
  getModule,
  listModules,
} from '@/services/inductionModules/inductionModuleService';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Company induction modules — standard content, written once.
 *
 * Moved here from Platform → Settings so that videos, company modules and a
 * project's own induction content are one area rather than three places. See
 * `InductionVideoWorkspace` for why the Settings placement was wrong.
 *
 * ── DELIBERATELY NOT SITE-SCOPED ──────────────────────────────────────────
 *
 * The videos listing next door redirects a viewer with no assigned sites away,
 * because a list of projects is meaningless without projects. This screen must
 * NOT copy that: company modules are company-wide, and on a tenant whose sites
 * are all archived a Director would otherwise be locked out of administering
 * company content by a guard that has nothing to do with it.
 */
export default async function InductionModulesPage() {
  const viewer = await requirePlatformViewer();
  // The gate is the page's own, not the area's. A Principal Contractor may work
  // on a project's video and still have no business reading company policy
  // administration.
  if (!canViewInductionModules(viewer.role)) redirect('/platform/dashboard');

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
      <InductionVideoWorkspace
        active="modules"
        areas={INDUCTION_VIDEO_AREAS}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Induction videos', href: '/platform/dashboard/induction-videos' },
              { label: 'Company modules' },
            ]}
          />
        }
      >
        <InductionModulesSection
          modules={rows}
          canDraft={canDraftInductionModule(viewer.role)}
          canIssue={canIssueInductionModule(viewer.role)}
        />
      </InductionVideoWorkspace>
    </PlatformShell>
  );
}
