import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings landing. Groups administrative configuration areas; the first
 * is Integrations (SMS provider). Access is Admin-only via the (dashboard)
 * layout guard. New settings areas are added as cards here.
 */
const SETTINGS_AREAS = [
  {
    href: '/admin/settings/integrations',
    title: 'Integrations',
    body: 'Configure the SMS provider used for worker verification codes — select the active provider, set credentials and test connectivity.',
    cta: 'Manage integrations',
  },
] as const;

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        <p className="text-ink-muted">
          Configure how SiteComply integrates with external services.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_AREAS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50"
          >
            <h2 className="text-base font-semibold text-ink">{a.title}</h2>
            <p className="mt-1 flex-1 text-sm text-ink-subtle">{a.body}</p>
            <span className="mt-3 text-sm font-semibold text-brand-700">{a.cta} →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
