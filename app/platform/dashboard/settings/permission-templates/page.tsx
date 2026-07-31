import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { PermissionTemplateLibrary } from '@/components/platform/PermissionTemplateLibrary';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { canManageSiteConfigTemplates } from '@/services/platformUsers/platformPermissions';
import {
  listPermissionTemplates,
  listCompanies,
  getCompanyDefaults,
} from '@/services/platformUsers/permissionTemplateService';

export const dynamic = 'force-dynamic';

/**
 * SC-022 Phase 2 — Settings → Permission templates.
 *
 * Organisation-wide GOVERNANCE, which is why it sits in Settings beside the
 * configuration templates rather than on a site: a template describes a kind of
 * contractor, and a company default describes a firm. Applying either to a
 * specific person on a specific project stays on that site's Access tab, where
 * the work actually happens.
 */
export default async function PermissionTemplatesPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canManageSiteConfigTemplates(viewer.role)) {
    redirect('/platform/dashboard');
  }

  const isDirector = viewer.role === 'DIRECTOR';
  const [templates, companies] = await Promise.all([
    listPermissionTemplates(true),
    isDirector ? listCompanies() : Promise.resolve([]),
  ]);

  // Only a Director sees or sets company defaults, so only a Director's page
  // loads them.
  const companyDefaults: Record<
    string,
    Awaited<ReturnType<typeof getCompanyDefaults>>
  > = {};
  if (isDirector) {
    for (const c of companies) {
      companyDefaults[c.company] = await getCompanyDefaults(c.company);
    }
  }

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Settings', href: '/platform/dashboard/settings' },
          { label: 'Permission templates' },
        ]}
      />
      <div className="mb-6">
        <h1 className="mt-1 text-2xl font-bold text-ink">
          Permission templates
        </h1>
        <p className="text-ink-muted">
          Reusable access restrictions for contractor types, and company-wide
          defaults.
        </p>
      </div>

      <PermissionTemplateLibrary
        templates={templates}
        companies={companies}
        companyDefaults={companyDefaults}
        canManageTemplates={canManageSiteConfigTemplates(viewer.role)}
        canSetCompanyDefaults={isDirector}
      />

      <p className="mt-6 text-sm text-ink-subtle">
        These only ever remove access — nothing here can grant someone more than
        their role already allows. Apply a template to a person from a site’s
        Access tab.
      </p>
    </PlatformShell>
  );
}
