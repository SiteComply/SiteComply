import { PlatformShell } from '@/components/platform/PlatformShell';
import { PlatformIcon } from '@/components/platform/icons';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { getDocumentExpiryNotifications } from '@/services/documents/documentExpiryNotifications';
import { NotificationsList } from '@/components/platform/NotificationsList';

export const dynamic = 'force-dynamic';

/**
 * Platform notifications — document-expiry reminders derived from the viewer's
 * in-scope documents (30 / 14 / 7-day reminders plus expired). Users can mark
 * individual notifications read/unread (state persists per user); the nav badge
 * counts only unread. Only documents on the viewer's Assigned Sites appear, and
 * nothing shows when an admin has turned "document expiry" notifications off.
 */
export default async function PlatformNotificationsPage() {
  const viewer = await requirePlatformViewer();
  // Document-expiry notifications require the documents module.
  assertModuleView(viewer, 'documents');

  const notifications = await getDocumentExpiryNotifications(viewer);

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Notifications</h1>
          <p className="text-ink-muted">
            Document expiry reminders across your sites.
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
            No documents are expiring soon or expired on your sites.
          </p>
        </div>
      ) : (
        <NotificationsList notifications={notifications} />
      )}
    </PlatformShell>
  );
}
