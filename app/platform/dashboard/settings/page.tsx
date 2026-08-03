import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PageHeader } from '@/components/platform/PageHeader';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { canManageSiteConfigTemplates } from '@/services/platformUsers/platformPermissions';

export const dynamic = 'force-dynamic';

/**
 * SC-021 — organisation-wide configuration.
 *
 * Separates GOVERNANCE from USAGE. Defining a standard is rare, organisation-wide
 * work owned by Directors and Project Managers; applying one to a site is
 * frequent work owned by Site Managers, and stays embedded in the site
 * experience where it is already done (Site Details → Compliance, the project
 * setup wizard, and site creation). Nothing about applying templates moved here.
 *
 * Exists as its own area rather than hanging off whichever module a setting
 * happens to touch: "where does organisation-wide configuration live?" has a
 * stable answer, whereas "which module owns this data?" changes as a feature
 * grows — which is exactly why this page moved twice before landing here.
 */
export default async function SettingsPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  // Matches the navigation restriction. Not a new permission: every page linked
  // from here keeps its own gates, and a role that reaches this URL directly is
  // still governed by those.
  if (!canManageSiteConfigTemplates(viewer.role)) {
    redirect('/platform/dashboard');
  }

  return (
    <PlatformShell>
      <PageHeader
        title="Settings"
        description="Organisation-wide configuration that applies across every site."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/platform/dashboard/settings/config-templates"
          className="group rounded-xl border border-line bg-surface p-5 transition-colors hover:border-brand-200 hover:bg-brand-50"
        >
          <h2 className="text-base font-bold text-ink group-hover:text-brand-700">
            Configuration templates
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Reusable sets of permits and inspections for a project type, client
            or industry — and the services every site must have.
          </p>
        </Link>
        <Link
          href="/platform/dashboard/settings/permission-templates"
          className="group rounded-xl border border-line bg-surface p-5 transition-colors hover:border-brand-200 hover:bg-brand-50"
        >
          <h2 className="text-base font-bold text-ink group-hover:text-brand-700">
            Permission templates
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Reusable access restrictions for contractor types, and company-wide
            defaults that a site cannot loosen.
          </p>
        </Link>
      </div>

      <p className="mt-6 text-sm text-ink-subtle">
        Applying a template to a site is done from the site itself — open a
        site’s Compliance tab or its project setup.
      </p>
    </PlatformShell>
  );
}
