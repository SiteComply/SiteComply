import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
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
  getPermissionTemplate,
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

  // Item sets, so an existing template can be EDITED in place rather than only
  // activated, deactivated or deleted.
  const details = await Promise.all(
    templates.map((t) => getPermissionTemplate(t.id)),
  );
  const itemsByTemplate: Record<string, { module: string; verbs: string[] }[]> =
    {};
  for (const d of details) {
    if (d) {
      itemsByTemplate[d.id] = d.items.map((i) => ({
        module: i.module,
        verbs: i.verbs,
      }));
    }
  }

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
      {/* UX REFRESH PHASE 8 — an area inside the Settings workspace rather than
          a separate destination reached from a chooser. The route is unchanged,
          so links here and the two historical redirects still resolve. */}
      <SettingsWorkspace active="permission-templates">
        <PermissionTemplateLibrary
          templates={templates}
          companies={companies}
          companyDefaults={companyDefaults}
          canManageTemplates={canManageSiteConfigTemplates(viewer.role)}
          canSetCompanyDefaults={isDirector}
          itemsByTemplate={itemsByTemplate}
        />

        <p className="mt-6 text-sm text-ink-subtle">
          These only ever remove access — nothing here can grant someone more
          than their role already allows. Apply a template to a person from a
          site’s Access tab.
        </p>
      </SettingsWorkspace>
    </PlatformShell>
  );
}
