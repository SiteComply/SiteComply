import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { ModulesArchive } from '@/components/inductionModules/ModulesArchive';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { canViewInductionModules } from '@/services/inductionModules/inductionModuleService';
import { retiredModuleRows } from '@/services/inductionModules/moduleRows';

export const dynamic = 'force-dynamic';

/**
 * Retired company modules, in the Platform.
 *
 * A sub-route of Company Modules rather than a fourth area in the nav: this is where
 * that catalogue's history lives, not a peer of Sites and Library. Reading it needs
 * the same gate as reading the catalogue; restoring happens on a module's own page.
 */
export default async function PlatformModulesArchivePage() {
  const viewer = await requirePlatformViewer();
  if (!canViewInductionModules(viewer.role)) redirect('/platform/dashboard');

  const modules = await retiredModuleRows();

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Induction videos', href: '/platform/dashboard/induction-videos' },
          { label: 'Company modules', href: '/platform/dashboard/induction-videos/modules' },
          { label: 'Retired' },
        ]}
      />
      <ModulesArchive
        modules={modules}
        backHref="/platform/dashboard/induction-videos/modules"
        basePath="/platform/dashboard/induction-videos/modules"
      />
    </PlatformShell>
  );
}
