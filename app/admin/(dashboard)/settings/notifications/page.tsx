import Link from 'next/link';
import { getNotificationConfigForAdmin } from '@/services/notifications/notificationConfigService';
import { NOTIFICATION_TYPES } from '@/services/notifications/notificationCatalog';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Notifications — READ-ONLY.
 *
 * Notification settings are owned by Platform Settings → Notifications, where
 * a Director sets them. This page used to be a second editor of the same
 * singleton row: both surfaces wrote `notifications`, under different
 * permissions (Admin Centre write roles here, Director there) and with
 * different controls, so the same organisation-wide setting could be changed
 * from two places and neither screen showed what the other had done.
 *
 * It stays as the platform operator's fallback — an operator supporting a
 * customer can still see what is configured without holding a Platform
 * Director account — but it can no longer change anything. The matching POST
 * route answers 409 with the same explanation.
 *
 * The per-channel (email / SMS) toggles this page used to offer are gone with
 * the editing. Nothing ever read them: getNotificationChannels() returns an
 * empty list for every type and its only caller has no consumer. Removing the
 * controls removes a promise the product could not keep; the stored values are
 * left untouched for whenever delivery channels do ship.
 *
 * Admin-only via the (dashboard) layout guard. No write path, so no write
 * permission is consulted.
 */
export default async function NotificationSettingsPage() {
  const config = await getNotificationConfigForAdmin();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/settings"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Notifications</h1>
        <p className="text-ink-muted">
          Which platform notifications are active. Read-only.
        </p>
      </header>

      <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
        These settings are managed in{' '}
        <span className="font-semibold text-ink">
          Platform Settings → Notifications
        </span>{' '}
        by a Director. This view shows what is currently configured.
      </p>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">
          Platform notifications
        </h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          In-app notifications raised for the platform team.
        </p>

        <dl className="mt-4 divide-y divide-line">
          {NOTIFICATION_TYPES.map((t) => {
            const on = config.types[t.key]?.enabled ?? t.defaultEnabled;
            return (
              <div
                key={t.key}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <dt className="text-sm font-medium text-ink">{t.label}</dt>
                  <dd className="text-xs text-ink-subtle">{t.description}</dd>
                </div>
                <dd
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    on
                      ? 'bg-safe-50 text-safe-700'
                      : 'bg-surface-sunken text-ink-subtle'
                  }`}
                >
                  {on ? 'On' : 'Off'}
                </dd>
              </div>
            );
          })}
        </dl>

        {config.updatedByName && config.updatedAt ? (
          <p className="mt-4 text-xs text-ink-subtle">
            Last changed by {config.updatedByName} on{' '}
            {formatDateTimeUK(new Date(config.updatedAt))}.
          </p>
        ) : null}
      </section>
    </div>
  );
}
