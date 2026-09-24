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
} from '@/services/inductionModules/inductionModuleService';
import { moduleRowsForEditor } from '@/services/inductionModules/moduleRows';

export const dynamic = 'force-dynamic';

/**
 * Company induction modules — standard content, written once.
 *
 * One of TWO front doors onto the same modules; the other is Admin Centre →
 * Settings → Induction modules. Same data, same service, same approval workflow,
 * same audit trail — see `moduleActions.ts`. Nothing here is a copy.
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

  const rows = await moduleRowsForEditor();

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
        <p className="mb-3 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          These are the same company modules administrators manage in the Admin
          Centre. Whichever place a change is made, it is the same content and the
          history records where it came from.
        </p>
        <InductionModulesSection
          modules={rows}
          canDraft={canDraftInductionModule(viewer.role)}
          canIssue={canIssueInductionModule(viewer.role)}
          endpoint="/api/platform/induction-modules"
        />
      </InductionVideoWorkspace>
    </PlatformShell>
  );
}
