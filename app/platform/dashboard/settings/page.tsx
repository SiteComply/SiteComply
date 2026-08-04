import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
import { ConfigTemplatesSection } from '@/components/platform/ConfigTemplatesSection';
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
      {/* UX REFRESH PHASE 8 — this page used to contain nothing but two feature
          cards linking elsewhere: a menu, not a screen, and the reason two
          related governance functions read as independent widgets. It now lands
          directly in the first area, with the other one click away in the
          workspace navigator.

          The redirect above is UNCHANGED and stays here deliberately: unlike
          /settings/config-templates, this route has always turned a non-manager
          away, and rendering the section must not quietly relax that. */}
      <SettingsWorkspace active="config-templates">
        <ConfigTemplatesSection />
      </SettingsWorkspace>
    </PlatformShell>
  );
}
