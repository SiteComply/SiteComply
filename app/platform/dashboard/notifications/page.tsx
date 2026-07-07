import { PlatformShell } from '@/components/platform/PlatformShell';
import { PlatformIcon } from '@/components/platform/icons';
import {
  requirePlatformViewer,
  describeScope,
} from '@/services/platformUsers/platformAccess';
import { getPlatformNotifications } from '@/services/notifications/platformNotifications';
import { NotificationsList } from '@/components/platform/NotificationsList';

export const dynamic = 'force-dynamic';

/**
 * Platform notifications — a unified, derived feed across sources: document
 * expiry reminders and action overdue / due-soon / newly-assigned alerts. Each
 * source is gated by its notification type + the viewer's module RBAC and scoped
 * to the viewer's Assigned Sites, so only notifications the viewer can access
 * appear. Users can mark items read/unread (persisted per user).
 */
export default async function PlatformNotificationsPage() {
  const viewer = await requirePlatformViewer();
  const notifications = await getPlatformNotifications(viewer);

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Notifications</h1>
          <p className="text-ink-muted">
            Document expiry and action reminders across your sites.
          </p>
        </div>
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {describeScope(viewer)}
        </span>
      </header>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-10 text-center shadow-card">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-safe-50 text-safe-700">
            <PlatformIcon name="bell" className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-ink">You’re all caught up</p>
          <p className="mt-1 text-sm text-ink-subtle">
            You have no notifications right now.
          </p>
        </div>
      ) : (
        <NotificationsList notifications={notifications} />
      )}
    </PlatformShell>
  );
}
