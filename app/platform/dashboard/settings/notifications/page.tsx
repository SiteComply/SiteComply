import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
import { NotificationSettingsWorkspace } from '@/components/platform/NotificationSettingsWorkspace';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  canManageSiteConfigTemplates,
  canManageNotificationSettings,
} from '@/services/platformUsers/platformPermissions';
import { getPlatformNotificationSettings } from '@/services/notifications/notificationConfigService';

export const dynamic = 'force-dynamic';

/**
 * Settings → Notifications.
 *
 * Organisation-wide defaults for what SiteComply tells people about. Every
 * switch here reaches an enforcement point: the catalogue was trimmed to the
 * types that are actually consulted, and the reminder lead times are read by
 * the services that build the reminders rather than displayed beside them.
 *
 * TWO GATES: the Settings area (Director + Project Manager) to view, Director
 * only to edit, enforced again on the API.
 */
export default async function NotificationSettingsPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canManageSiteConfigTemplates(viewer.role)) {
    redirect('/platform/dashboard');
  }

  const settings = await getPlatformNotificationSettings();

  return (
    <PlatformShell>
      <SettingsWorkspace active="notifications">
        <NotificationSettingsWorkspace
          settings={settings}
          canEdit={canManageNotificationSettings(viewer.role)}
        />
      </SettingsWorkspace>
    </PlatformShell>
  );
}
