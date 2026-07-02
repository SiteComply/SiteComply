import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { AccessRequestForm } from '@/components/platform/AccessRequestForm';

export const dynamic = 'force-dynamic';

/**
 * Public "Request platform access" page, reached from the login screen when the
 * entered email/mobile doesn't match a Platform User. Prefills whichever
 * identifier the user tried.
 */
export default function RequestAccessPage({
  searchParams,
}: {
  searchParams: { email?: string | string[]; mobile?: string | string[] };
}) {
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? '';

  return (
    <AppShell>
      <div className="mx-auto max-w-sm space-y-6 py-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold text-ink">Request platform access</h1>
          <p className="text-ink-muted">
            We couldn’t find a platform account for you. Share a few details and
            an administrator will set up your access.
          </p>
        </div>

        <AccessRequestForm
          initialEmail={one(searchParams.email)}
          initialMobile={one(searchParams.mobile)}
        />

        <p className="text-center text-xs text-ink-subtle">
          <Link href="/platform" className="font-semibold text-brand-700">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
