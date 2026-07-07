'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { DocumentExpiryBadge } from '@/components/platform/DocumentExpiryBadge';
import { PlatformIcon } from '@/components/platform/icons';
import { documentCategoryLabel } from '@/services/documents/documentConstants';
import { formatDateUK } from '@/lib/datetime';
import type { DocumentExpiryNotification } from '@/services/documents/documentExpiryNotifications';

type Filter = 'all' | 'unread' | 'read';

/**
 * The interactive notifications list. Keeps the Expired / Expiring soon
 * categories and card styling, and adds:
 *  - All / Unread / Read filters (defaults to Unread — the actionable view);
 *  - clearly muted, de-emphasised styling for read notifications (no unread dot);
 *  - per-notification read/unread toggles + a "Mark all as read" action;
 *  - a friendly empty state per filter ("You're all caught up").
 * Read state persists per user; router.refresh() re-derives the list + nav badge.
 */
export function NotificationsList({
  notifications,
}: {
  notifications: DocumentExpiryNotification[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('unread');
  const [busyKey, setBusyKey] = useState<string | undefined>();
  const [busyAll, setBusyAll] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const readCount = notifications.length - unreadCount;

  const visible = notifications.filter((n) =>
    filter === 'unread' ? !n.read : filter === 'read' ? n.read : true,
  );
  const expired = visible.filter((n) => n.status === 'EXPIRED');
  const expiring = visible.filter((n) => n.status === 'EXPIRING_SOON');

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
        <div
          role="group"
          aria-label="Filter notifications"
          className="inline-flex rounded-lg border border-line bg-surface p-0.5"
        >
          <Tab label="All" count={notifications.length} active={filter === 'all'} onClick={() => setFilter('all')} />
          <Tab label="Unread" count={unreadCount} active={filter === 'unread'} onClick={() => setFilter('unread')} />
          <Tab label="Read" count={readCount} active={filter === 'read'} onClick={() => setFilter('read')} />
        </div>
        <button
          type="button"
          onClick={markAll}
          disabled={busyAll || unreadCount === 0}
          className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          {busyAll ? 'Marking…' : 'Mark all as read'}
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-6">
          {expired.length > 0 && (
            <Group title="Expired" count={expired.length} accent="text-danger-700" items={expired} busyKey={busyKey} onToggle={toggle} />
          )}
          {expiring.length > 0 && (
            <Group title="Expiring soon" count={expiring.length} accent="text-hivis-600" items={expiring} busyKey={busyKey} onToggle={toggle} />
          )}
        </div>
      )}
    </div>
  );
}

function Tab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-brand-500 text-white' : 'text-ink-muted hover:text-brand-700',
      )}
    >
      {label}
      <span className={cn('ml-1.5 tabular-nums', active ? 'text-white/80' : 'text-ink-subtle')}>
        {count}
      </span>
    </button>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const copy =
    filter === 'read'
      ? {
          title: 'No read notifications',
          body: 'Notifications you mark as read will appear here.',
        }
      : {
          title: 'You’re all caught up',
          body:
            filter === 'unread'
              ? 'You have no unread notifications.'
              : 'You have no notifications right now.',
        };
  return (
    <div className="rounded-xl border border-line bg-surface p-10 text-center shadow-card">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-safe-50 text-safe-700">
        <PlatformIcon name="bell" className="h-6 w-6" />
      </div>
      <p className="text-sm font-semibold text-ink">{copy.title}</p>
      <p className="mt-1 text-sm text-ink-subtle">{copy.body}</p>
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
              'rounded-xl border p-4 shadow-card transition-colors',
              n.read
                ? 'border-line bg-surface-sunken' // read → muted, de-emphasised
                : 'border-brand-300 bg-surface', // unread → stands out
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {!n.read && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-brand-500"
                      aria-hidden="true"
                    />
                  )}
                  <Link
                    href={`/platform/dashboard/documents/${n.documentId}`}
                    className={cn(
                      'hover:underline',
                      n.read ? 'font-medium text-ink-muted' : 'font-semibold text-brand-700',
                    )}
                  >
                    {n.title}
                  </Link>
                  {/* Read/unread state is conveyed to assistive tech in text, not just colour. */}
                  <span className="sr-only">{n.read ? '(read)' : '(unread)'}</span>
                  <DocumentExpiryBadge expiresAt={n.expiresAt} />
                  {n.threshold !== null && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        n.read ? 'bg-surface text-ink-subtle' : 'bg-surface-sunken text-ink-subtle',
                      )}
                    >
                      {n.threshold}-day reminder
                    </span>
                  )}
                </div>
                <p className={cn('mt-1 text-sm', n.read ? 'text-ink-muted' : 'text-ink')}>
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
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-50"
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
