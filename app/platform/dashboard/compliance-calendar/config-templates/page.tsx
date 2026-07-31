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
 * Lives under Compliance because a configuration template answers "which
 * compliance processes apply to this project?" — a compliance question, not a
 * site-records one. Reached as a secondary action from the Compliance Calendar,
 * mirroring how SC-013's audit template library hangs off the Audits page
 * rather than taking a top-level nav slot.
 *
 * Viewing still needs `sites:view`, deliberately UNCHANGED by the move: every
 * role holds both `sites:view` and `audits:view`, so switching the gate would
 * alter nothing in practice while still being an edit to permission code. The
 * mismatch between the URL's section and the gate's module is intentional, not
 * an oversight.
 *
 * Managing a shared template is Director/Project Manager; setting a company
 * requirement is Director only. Each gate is enforced in the service and the
 * API too — this page only decides what to show.
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
          {
            label: 'Compliance',
            href: '/platform/dashboard/compliance-calendar',
          },
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
