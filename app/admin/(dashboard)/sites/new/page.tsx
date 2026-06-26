import Link from 'next/link';
import { SiteForm } from '@/components/admin/SiteForm';

export const dynamic = 'force-dynamic';

/** Create a new job site. */
export default function NewSitePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/sites"
          className="text-sm font-semibold text-brand-700"
        >
          ← Back to job sites
        </Link>
        <h1 className="text-2xl font-bold text-ink">New job site</h1>
        <p className="text-ink-muted">
          The site starts active with a default UK induction checklist, which
          you can tailor afterwards.
        </p>
      </header>

      <SiteForm mode="create" />
    </div>
  );
}
