import Link from 'next/link';
import { SmsProviderSettings } from '@/components/admin/SmsProviderSettings';
import { SMS_PROVIDERS } from '@/services/sms/providerCatalog';
import { getSmsConfigForAdmin } from '@/services/sms/smsConfigService';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Integrations. Provider-agnostic SMS configuration. The
 * current config is loaded server-side (no secret plaintext is ever sent to the
 * browser — only non-secret values and "is set" flags). Admin-only via the
 * (dashboard) layout guard.
 */
export default async function IntegrationsPage() {
  const config = await getSmsConfigForAdmin();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/settings" className="text-sm font-semibold text-brand-700 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Integrations</h1>
        <p className="text-ink-muted">
          SMS provider used to send worker sign-in verification codes. Secret
          values are stored encrypted and never shown again.
        </p>
      </header>

      <SmsProviderSettings providers={SMS_PROVIDERS} config={config} />
    </div>
  );
}
