import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { ConfigTemplateLibrary } from '@/components/platform/ConfigTemplateLibrary';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  permits,
  canManageSiteConfigTemplates,
} from '@/services/platformUsers/platformPermissions';
import {
  listAllConfigTemplates,
  listMandatoryPolicy,
} from '@/services/siteServices/siteConfigTemplateService';

export const dynamic = 'force-dynamic';

/**
 * SC-021 Phase 2 — shared configuration templates and company requirements.
 *
 * Viewing needs `sites:view`; managing a shared template is Director/Project
 * Manager; setting a company requirement is Director only. Each gate is
 * enforced in the service and the API too — this page only decides what to
 * show.
 */
export default async function ConfigTemplatesPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const [templates, policy] = await Promise.all([
    listAllConfigTemplates(),
    viewer.role === 'DIRECTOR' ? listMandatoryPolicy() : Promise.resolve([]),
  ]);

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Sites', href: '/platform/dashboard/sites' },
          { label: 'Configuration templates' },
        ]}
      />
      <div className="mb-6">
        <h1 className="mt-1 text-2xl font-bold text-ink">
          Configuration templates
        </h1>
        <p className="text-ink-muted">
          Reuse a set of permits and inspections across similar projects, and
          set the services every site must have.
        </p>
      </div>

      <ConfigTemplateLibrary
        templates={templates}
        canManage={canManageSiteConfigTemplates(viewer.role)}
        policy={policy}
        canSetPolicy={viewer.role === 'DIRECTOR'}
      />

      {permits(viewer.role, 'sites', 'edit') ? (
        <p className="mt-6 text-sm text-ink-subtle">
          To create a template, open a site’s{' '}
          <Link
            href="/platform/dashboard/sites"
            className="font-semibold text-brand-700 hover:underline"
          >
            Compliance tab
          </Link>
          , set which permits and inspections apply, then choose “Save this site
          as a template”.
        </p>
      ) : null}
    </PlatformShell>
  );
}
