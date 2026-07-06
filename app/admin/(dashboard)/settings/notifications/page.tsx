import Link from 'next/link';
import { NotificationSettings } from '@/components/admin/NotificationSettings';
import { getNotificationConfigForAdmin } from '@/services/notifications/notificationConfigService';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import { ReadOnlyBanner } from '@/components/admin/ReadOnlyBanner';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Notifications. Per-type enable toggles and per-channel
 * (email / SMS) delivery preferences for platform notifications. Settings are
 * stored in the DB and read at runtime by notification consumers via
 * getNotificationRuntimeConfig / isNotificationEnabled — no redeploy needed.
 * Admin-only via the (dashboard) layout guard.
 */
export default async function NotificationSettingsPage() {
  const config = await getNotificationConfigForAdmin();
  const canManage = adminCanManage(getAdminSession()?.role);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/settings" className="text-sm font-semibold text-brand-700 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Notifications</h1>
        <p className="text-ink-muted">
          Choose which platform notifications are active and how they will be
          delivered. Changes apply immediately.
        </p>
      </header>

      {!canManage && <ReadOnlyBanner />}

      <NotificationSettings config={config} canManage={canManage} />
    </div>
  );
}
