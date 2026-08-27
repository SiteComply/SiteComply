'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { PlatformIcon } from '@/components/platform/icons';
import {
  NOTIFICATION_GROUP_META,
  type NotificationGroup,
  type PlatformNotification,
} from '@/services/notifications/notificationTypes';

type Filter = 'all' | 'unread' | 'read';

const GROUP_ORDER = (Object.keys(NOTIFICATION_GROUP_META) as NotificationGroup[]).sort(
  (a, b) => NOTIFICATION_GROUP_META[a].order - NOTIFICATION_GROUP_META[b].order,
);

/**
 * The interactive notifications list. Renders the unified notification feed
 * (document expiry + action alerts) grouped by category, with:
 *  - All / Unread / Read filters (defaults to Unread);
 *  - clearly muted, de-emphasised styling for read notifications (no unread dot);
 *  - per-notification read/unread toggles + a "Mark all as read" action;
 *  - a friendly empty state per filter.
 * Read state persists per user; router.refresh() re-derives the list + nav badge.
 */
export function NotificationsList({
  notifications,
}: {
  notifications: PlatformNotification[];
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

  async function toggle(n: PlatformNotification) {
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
          {GROUP_ORDER.map((group) => {
            const items = visible.filter((n) => n.group === group);
            if (items.length === 0) return null;
            const meta = NOTIFICATION_GROUP_META[group];
            return (
              <Group
                key={group}
                title={meta.title}
                count={items.length}
                accent={meta.accent}
                items={items}
                busyKey={busyKey}
                onToggle={toggle}
              />
            );
          })}
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
      ? { title: 'No read notifications', body: 'Notifications you mark as read will appear here.' }
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
  items: PlatformNotification[];
  busyKey: string | undefined;
  onToggle: (n: PlatformNotification) => void;
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
              n.read ? 'border-line bg-surface-sunken' : 'border-brand-300 bg-surface',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {!n.read && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                  )}
                  <Link
                    href={n.href}
                    className={cn(
                      'hover:underline',
                      n.read ? 'font-medium text-ink-muted' : 'font-semibold text-brand-700',
                    )}
                  >
                    {n.title}
                  </Link>
                  <span className="sr-only">{n.read ? '(read)' : '(unread)'}</span>
                  <span
                    className={cn(
                      'inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      n.badgeClass,
                    )}
                  >
                    {n.badgeLabel}
                  </span>
                  {n.chip && (
                    <span className="whitespace-nowrap rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">
                      {n.chip}
                    </span>
                  )}
                </div>
                <p className={cn('mt-1 text-sm', n.read ? 'text-ink-muted' : 'text-ink')}>
                  <span className="font-medium">{n.message}</span>
                  <span className="text-ink-subtle"> · {n.context}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">{n.meta}</p>
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
                  href={n.href}
                  className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  View
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
