import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { listActiveConfigTemplates } from '@/services/siteServices/siteConfigTemplateService';
import { SiteForm } from '@/components/platform/SiteForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { canCreateSite } from '@/services/platformUsers/platformPermissions';

export const dynamic = 'force-dynamic';

/**
 * Platform → New site. Director-only: creating a site organisation-wide is a
 * Director capability, so any other role is redirected back to the Sites list
 * (the create affordance is also hidden from them). The API enforces the same
 * gate, so this page is a convenience, not the security boundary.
 */
export default async function NewSitePage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canCreateSite(viewer.role)) {
    redirect('/platform/dashboard/sites');
  }

  // SC-021 Phase 2 — offer a configuration template at creation.
  const configTemplates = (await listActiveConfigTemplates()).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category as string,
  }));

  return (
    <PlatformShell>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: 'Sites', href: '/platform/dashboard/sites' },
            { label: 'New site' },
          ]}
        />
        <Link
          href="/platform/dashboard/sites"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Sites
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">New site</h1>
        <p className="text-ink-muted">
          Add a new job site to your organisation. It becomes available for
          check-ins, reporting, audits, actions and documents straight away.
        </p>
      </div>

      <SiteForm mode="create" configTemplates={configTemplates} />
    </PlatformShell>
  );
}
