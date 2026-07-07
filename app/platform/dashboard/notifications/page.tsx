import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PlatformIcon } from '@/components/platform/icons';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { getDocumentExpiryNotifications } from '@/services/documents/documentExpiryNotifications';
import { DocumentExpiryBadge } from '@/components/platform/DocumentExpiryBadge';
import { documentCategoryLabel } from '@/services/documents/documentConstants';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Platform notifications — currently document-expiry reminders derived from the
 * viewer's in-scope documents (30 / 14 / 7-day reminders plus expired). Only
 * documents on the viewer's Assigned Sites appear; nothing shows when an admin
 * has turned the "document expiry" notification off.
 */
export default async function PlatformNotificationsPage() {
  const viewer = await requirePlatformViewer();
  // Document-expiry notifications require the documents module.
  assertModuleView(viewer, 'documents');

  const notifications = await getDocumentExpiryNotifications(viewer);
  const expired = notifications.filter((n) => n.status === 'EXPIRED');
  const expiring = notifications.filter((n) => n.status === 'EXPIRING_SOON');

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
        <div className="space-y-8">
          {expired.length > 0 && (
            <Group
              title="Expired"
              count={expired.length}
              items={expired}
              accent="text-danger-700"
            />
          )}
          {expiring.length > 0 && (
            <Group
              title="Expiring soon"
              count={expiring.length}
              items={expiring}
              accent="text-hivis-600"
            />
          )}
        </div>
      )}
    </PlatformShell>
  );
}

function Group({
  title,
  count,
  items,
  accent,
}: {
  title: string;
  count: number;
  items: Awaited<ReturnType<typeof getDocumentExpiryNotifications>>;
  accent: string;
}) {
  return (
    <section>
      <h2 className={`mb-3 text-sm font-semibold uppercase tracking-wide ${accent}`}>
        {title} ({count})
      </h2>
      <ul className="space-y-3">
        {items.map((n) => (
          <li
            key={n.documentId}
            className="rounded-xl border border-line bg-surface p-4 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/platform/dashboard/documents/${n.documentId}`}
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    {n.title}
                  </Link>
                  <DocumentExpiryBadge expiresAt={n.expiresAt} />
                  {n.threshold !== null && (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">
                      {n.threshold}-day reminder
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink">
                  <span className="font-medium">{n.message}</span>
                  <span className="text-ink-subtle">
                    {' '}
                    · {documentCategoryLabel(n.category)} · {n.jobSiteName}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {n.fileName} · expires {formatDateUK(n.expiresAt)}
                </p>
              </div>
              <Link
                href={`/platform/dashboard/documents/${n.documentId}`}
                className="shrink-0 rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                View document
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
