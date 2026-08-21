import Link from 'next/link';
import { getCompanyConfigForAdmin } from '@/services/company/companyConfigService';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Company — READ-ONLY.
 *
 * Company profile, branding and logos are owned by Platform Settings → Company
 * profile & branding, where a Director sets them. This page used to be a second
 * editor of the same singleton row: both surfaces wrote `company`, under
 * different permissions, so the same organisation-wide values could be changed
 * from two places and neither screen showed what the other had done.
 *
 * The write routes were retired first (both /api/admin/settings/company and
 * .../company/logo answer 409), but the form was left in place — so the screen
 * still invited an edit it would then refuse, and its text inputs stayed
 * typable. The controls are gone now; this shows the configured values only.
 *
 * It stays as the platform operator's fallback — an operator supporting a
 * customer can still see what is configured without holding a Platform Director
 * account — but it can no longer change anything.
 *
 * Admin-only via the (dashboard) layout guard. No write path, so no write
 * permission is consulted.
 */
export default async function CompanySettingsPage() {
  const config = await getCompanyConfigForAdmin();

  const profile: { label: string; value: string }[] = [
    { label: 'Company name', value: config.companyName },
    { label: 'Support email', value: config.supportEmail || 'Not set' },
    { label: 'Support phone', value: config.supportPhone || 'Not set' },
    { label: 'Tagline', value: config.tagline || 'Not set' },
  ];

  const branding: { label: string; value: string; swatch?: string }[] = [
    {
      label: 'Primary colour',
      value: config.primaryColor,
      swatch: config.primaryColor,
    },
    {
      label: 'Accent colour',
      value: config.accentColor,
      swatch: config.accentColor,
    },
    { label: 'Company logo', value: config.hasLogo ? 'Set' : 'Not set' },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/settings"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Company</h1>
        <p className="text-ink-muted">
          Your organisation’s name, support contacts, branding and logo.
          Read-only.
        </p>
      </header>

      <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
        These settings are managed in{' '}
        <span className="font-semibold text-ink">
          Platform Settings → Company profile & branding
        </span>{' '}
        by a Director, which also covers the company address, registration
        number, disclaimer and the print logo. This view shows what is currently
        configured.
      </p>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Company profile</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          The organisation name and the support contacts shown to users.
        </p>
        <dl className="mt-4 divide-y divide-line">
          {profile.map((f) => (
            <div
              key={f.label}
              className="flex items-start justify-between gap-4 py-3"
            >
              <dt className="text-sm font-medium text-ink">{f.label}</dt>
              <dd className="shrink-0 text-sm text-ink-muted">{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Branding</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          Organisation colours and logo used across branded surfaces.
        </p>
        <dl className="mt-4 divide-y divide-line">
          {branding.map((f) => (
            <div
              key={f.label}
              className="flex items-start justify-between gap-4 py-3"
            >
              <dt className="text-sm font-medium text-ink">{f.label}</dt>
              <dd className="flex shrink-0 items-center gap-2 text-sm text-ink-muted">
                {f.swatch && (
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded border border-line"
                    style={{ backgroundColor: f.swatch }}
                  />
                )}
                {f.value}
              </dd>
            </div>
          ))}
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
