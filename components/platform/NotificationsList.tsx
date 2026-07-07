'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { DocumentExpiryBadge } from '@/components/platform/DocumentExpiryBadge';
import { documentCategoryLabel } from '@/services/documents/documentConstants';
import { formatDateUK } from '@/lib/datetime';
import type { DocumentExpiryNotification } from '@/services/documents/documentExpiryNotifications';

/**
 * The interactive notifications list: keeps the Expired / Expiring soon
 * categories and card styling, and adds per-notification read/unread toggles
 * plus a "Mark all as read" action. Read state persists per user via the
 * /api/platform/notifications endpoints; router.refresh() re-derives the list
 * and the nav badge so counts stay in step.
 */
export function NotificationsList({
  notifications,
}: {
  notifications: DocumentExpiryNotification[];
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | undefined>();
  const [busyAll, setBusyAll] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const expired = notifications.filter((n) => n.status === 'EXPIRED');
  const expiring = notifications.filter((n) => n.status === 'EXPIRING_SOON');

  async function toggle(n: DocumentExpiryNotification) {
    setBusyKey(n.key);
    try {
      const res = await fetch('/api/platform/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: n.key, read: !n.read }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyKey(undefined);
    }
  }

  async function markAll() {
    setBusyAll(true);
    try {
      const res = await fetch('/api/platform/notifications/read-all', { method: 'POST' });
      if (res.ok) router.refresh();
    } finally {
      setBusyAll(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-subtle">
          {unreadCount > 0
            ? `${unreadCount} unread of ${notifications.length}`
            : `All ${notifications.length} read`}
        </p>
        <button
          type="button"
          onClick={markAll}
          disabled={busyAll || unreadCount === 0}
          className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          {busyAll ? 'Marking…' : 'Mark all as read'}
        </button>
      </div>

      {expired.length > 0 && (
        <Group title="Expired" count={expired.length} accent="text-danger-700" items={expired} busyKey={busyKey} onToggle={toggle} />
      )}
      {expiring.length > 0 && (
        <Group title="Expiring soon" count={expiring.length} accent="text-hivis-600" items={expiring} busyKey={busyKey} onToggle={toggle} />
      )}
    </div>
  );
}

function Group({
  title,
  count,
  accent,
  items,
  busyKey,
  onToggle,
}: {
  title: string;
  count: number;
  accent: string;
  items: DocumentExpiryNotification[];
  busyKey: string | undefined;
  onToggle: (n: DocumentExpiryNotification) => void;
}) {
  return (
    <section>
      <h2 className={`mb-3 text-sm font-semibold uppercase tracking-wide ${accent}`}>
        {title} ({count})
      </h2>
      <ul className="space-y-3">
        {items.map((n) => (
          <li
            key={n.key}
            className={cn(
              'rounded-xl border bg-surface p-4 shadow-card',
              n.read ? 'border-line' : 'border-brand-300',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {!n.read && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-brand-500"
                      aria-label="Unread"
                    />
                  )}
                  <Link
                    href={`/platform/dashboard/documents/${n.documentId}`}
                    className={cn(
                      'hover:underline',
                      n.read ? 'font-medium text-ink' : 'font-semibold text-brand-700',
                    )}
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
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggle(n)}
                  disabled={busyKey === n.key}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
                >
                  {n.read ? 'Mark as unread' : 'Mark as read'}
                </button>
                <Link
                  href={`/platform/dashboard/documents/${n.documentId}`}
                  className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  View document
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
