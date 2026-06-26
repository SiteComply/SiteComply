import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { getAdminSession } from '@/lib/session';
import { isAzureAdConfigured } from '@/services/auth/adminAuth';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  config: 'Admin sign-in is not configured for this environment.',
  state: 'Your sign-in attempt expired. Please try again.',
  sso: 'Microsoft sign-in was cancelled or failed. Please try again.',
  exchange: 'We couldn’t complete sign-in. Please try again.',
};

/**
 * Admin sign-in. Single "Sign in with Microsoft" action that runs the Azure AD
 * SSO flow (or a development sign-in locally). Already-authenticated admins are
 * sent straight to the dashboard.
 */
export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  if (getAdminSession()) redirect('/admin');

  // Dev sign-in only applies when Azure AD is unconfigured AND not in production.
  const devSignIn =
    !isAzureAdConfigured() && process.env.NODE_ENV !== 'production';
  const error = searchParams.error ? ERRORS[searchParams.error] : undefined;

  return (
    <AppShell>
      <div className="mx-auto max-w-sm space-y-6 py-8 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-ink">Admin sign-in</h1>
          <p className="text-ink-muted">
            Manage your job sites, inductions and compliance records.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger-500 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700"
          >
            {error}
          </p>
        )}

        <a href="/api/admin/auth/login" className="block">
          <Button size="lg" fullWidth>
            Sign in with Microsoft
          </Button>
        </a>

        {devSignIn && (
          <p className="rounded-xl border border-hivis-500 bg-hivis-400/15 px-4 py-3 text-xs text-ink">
            Azure AD isn’t configured in this environment, so this is a{' '}
            <strong>development sign-in</strong>. Set the{' '}
            <code>AZURE_AD_*</code> variables to enable Microsoft SSO.
          </p>
        )}

        <p className="text-xs text-ink-subtle">
          Workers don’t sign in here — they check in from the{' '}
          <a href="/check-in" className="font-semibold text-brand-700">
            site check-in
          </a>{' '}
          page.
        </p>
      </div>
    </AppShell>
  );
}
