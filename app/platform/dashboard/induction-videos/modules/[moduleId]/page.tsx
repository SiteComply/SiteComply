import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { ModuleDetail } from '@/components/inductionModules/ModuleDetail';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canDraftInductionModule,
  canIssueInductionModule,
  canViewInductionModules,
} from '@/services/inductionModules/inductionModuleService';
import { moduleDetail } from '@/services/inductionModules/moduleDetail';

export const dynamic = 'force-dynamic';

/**
 * One company module, in the Platform.
 *
 * The working surface — wording, revisions, usage, settings — is `ModuleDetail`,
 * shared with the Admin Centre so the two front doors cannot disagree about the
 * same module. This page is the Platform's shell around it: its chrome, its
 * breadcrumbs and its permissions.
 *
 * DELIBERATELY NOT SITE-SCOPED, for the same reason the list is not: company
 * modules are company-wide, and a Director on a tenant whose projects are all
 * archived must still be able to administer company content.
 */
export default async function PlatformModuleDetailPage({
  params,
}: {
  params: { moduleId: string };
}) {
  const viewer = await requirePlatformViewer();
  if (!canViewInductionModules(viewer.role)) redirect('/platform/dashboard');

  const module = await moduleDetail(params.moduleId);
  if (!module) notFound();

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Induction videos', href: '/platform/dashboard/induction-videos' },
          { label: 'Company modules', href: '/platform/dashboard/induction-videos/modules' },
          { label: module.title },
        ]}
      />
      <ModuleDetail
        module={module}
        canDraft={canDraftInductionModule(viewer.role)}
        canIssue={canIssueInductionModule(viewer.role)}
        endpoint="/api/platform/induction-modules"
        backHref="/platform/dashboard/induction-videos/modules"
        libraryBasePath="/platform/dashboard/induction-videos/library"
      />
    </PlatformShell>
  );
}
