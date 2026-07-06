import Link from 'next/link';
import { AuthConfigSettings } from '@/components/admin/AuthConfigSettings';
import { getAuthConfigForAdmin } from '@/services/auth/authConfigService';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import { ReadOnlyBanner } from '@/components/admin/ReadOnlyBanner';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Authentication. OTP expiry, max verification attempts,
 * session timeout and enabled OTP channels. Settings are stored in the DB and
 * read at runtime by the OTP service + platform session creation (and future
 * ACS / platform auth features) via getAuthRuntimeConfig — no redeploy needed.
 * Admin-only via the (dashboard) layout guard.
 */
export default async function AuthenticationSettingsPage() {
  const config = await getAuthConfigForAdmin();
  const canManage = adminCanManage(getAdminSession()?.role);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/settings" className="text-sm font-semibold text-brand-700 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Authentication</h1>
        <p className="text-ink-muted">
          Tune one-time passcodes, session timeout and the sign-in methods
          available across SiteComply. Changes apply to new sign-ins immediately.
        </p>
      </header>

      {!canManage && <ReadOnlyBanner />}

      <AuthConfigSettings config={config} canManage={canManage} />
    </div>
  );
}
