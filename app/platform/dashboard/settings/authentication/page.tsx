import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
import { AuthAccessSettings } from '@/components/platform/AuthAccessSettings';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  canManageSiteConfigTemplates,
  canManageAuthSettings,
} from '@/services/platformUsers/platformPermissions';
import { getPlatformAuthSettings } from '@/services/auth/authConfigService';

export const dynamic = 'force-dynamic';

/**
 * Settings → Authentication & Access.
 *
 * Organisation-wide login and access behaviour: how people sign in, how long
 * sessions last, and the minimum standard for reaching a site. It belongs in
 * Settings for the same reason the two template libraries do — it is GOVERNANCE,
 * set once for the organisation, not configuration of one project.
 *
 * TWO GATES, deliberately different:
 *   VIEW   — the Settings area gate (Director + Project Manager). A Project
 *            Manager can see the organisation's posture and raise it, which is
 *            more useful than a hidden page they cannot reason about.
 *   EDIT   — Director only, and enforced again on the API route. The read-only
 *            rendering below is a courtesy, not the permission.
 *
 * Only settings with a real enforcement point appear here. Microsoft Entra ID,
 * email OTP and single-session enforcement are absent because the behaviour
 * behind them does not exist yet; a control that silently does nothing is worse
 * than no control.
 */
export default async function AuthenticationSettingsPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canManageSiteConfigTemplates(viewer.role)) {
    redirect('/platform/dashboard');
  }

  const settings = await getPlatformAuthSettings();

  return (
    <PlatformShell>
      <SettingsWorkspace active="authentication">
        <AuthAccessSettings
          settings={settings}
          canEdit={canManageAuthSettings(viewer.role)}
        />
      </SettingsWorkspace>
    </PlatformShell>
  );
}
