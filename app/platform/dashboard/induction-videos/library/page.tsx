import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import {
  InductionVideoWorkspace,
  INDUCTION_VIDEO_AREAS,
} from '@/components/platform/InductionVideoWorkspace';
import { LibrarySection } from '@/components/inductionVideo/LibrarySection';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canDraftInductionModule,
  canIssueInductionModule,
  canViewInductionModules,
} from '@/services/inductionModules/inductionModuleService';
import { libraryRowsForEditor } from '@/services/inductionVideo/libraryRows';

export const dynamic = 'force-dynamic';

/**
 * The company video library, in the Platform.
 *
 * One of two front doors onto the same assets; the other is the Admin Centre. Same
 * data, same lifecycle, same dispatcher — see libraryActions.ts.
 *
 * Gated on the same predicate as company modules: this is central company content,
 * and whoever may read one may read the other. Deliberately NOT site-scoped, for
 * the reason the modules page is not — company footage belongs to no project.
 */
export default async function InductionLibraryPage() {
  const viewer = await requirePlatformViewer();
  if (!canViewInductionModules(viewer.role)) redirect('/platform/dashboard');

  const { assets, modules, totalProjects } = await libraryRowsForEditor();

  return (
    <PlatformShell>
      <InductionVideoWorkspace
        active="library"
        areas={INDUCTION_VIDEO_AREAS}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Induction videos', href: '/platform/dashboard/induction-videos' },
              { label: 'Library' },
            ]}
          />
        }
      >
        <p className="mb-3 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          These are the same library videos administrators manage in the Admin
          Centre. Whichever place a change is made, it is the same footage and the
          history records where it came from.
        </p>
        <LibrarySection
          assets={assets}
          modules={modules}
          canDraft={canDraftInductionModule(viewer.role)}
          canIssue={canIssueInductionModule(viewer.role)}
          endpoint="/api/platform/induction-library"
          totalProjects={totalProjects}
          detailHref={(id) => `/platform/dashboard/induction-videos/library/${id}`}
        />
      </InductionVideoWorkspace>
    </PlatformShell>
  );
}
