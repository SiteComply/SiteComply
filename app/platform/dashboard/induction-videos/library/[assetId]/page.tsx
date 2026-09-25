import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import {
  InductionVideoWorkspace,
  INDUCTION_VIDEO_AREAS,
} from '@/components/platform/InductionVideoWorkspace';
import { LibraryAssetDetail } from '@/components/inductionVideo/LibraryAssetDetail';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canDraftInductionModule,
  canIssueInductionModule,
  canViewInductionModules,
} from '@/services/inductionModules/inductionModuleService';
import { libraryAssetDetail } from '@/services/inductionVideo/libraryDetail';
import { listModules } from '@/services/inductionModules/inductionModuleService';

export const dynamic = 'force-dynamic';

/**
 * One library video, in the Platform. The Admin Centre has the same page over the
 * same data and the same dispatcher; only the shell and the endpoint differ.
 */
export default async function LibraryAssetPage({ params }: { params: { assetId: string } }) {
  const viewer = await requirePlatformViewer();
  if (!canViewInductionModules(viewer.role)) redirect('/platform/dashboard');

  const [asset, modules] = await Promise.all([
    libraryAssetDetail(params.assetId),
    listModules(),
  ]);
  if (!asset) notFound();

  return (
    <PlatformShell>
      <InductionVideoWorkspace
        active="library"
        areas={INDUCTION_VIDEO_AREAS}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Induction videos', href: '/platform/dashboard/induction-videos' },
              { label: 'Library', href: '/platform/dashboard/induction-videos/library' },
              { label: asset.title },
            ]}
          />
        }
      >
        <LibraryAssetDetail
          asset={asset}
          modules={modules.map((m: { id: string; title: string }) => ({ id: m.id, title: m.title }))}
          canDraft={canDraftInductionModule(viewer.role)}
          canIssue={canIssueInductionModule(viewer.role)}
          endpoint="/api/platform/induction-library"
          videoHrefBase="/platform/dashboard/induction-videos"
          backHref="/platform/dashboard/induction-videos/library"
        />
      </InductionVideoWorkspace>
    </PlatformShell>
  );
}
