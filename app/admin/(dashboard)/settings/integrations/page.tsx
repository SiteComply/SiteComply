import Link from 'next/link';
import { SmsProviderSettings } from '@/components/admin/SmsProviderSettings';
import { SMS_PROVIDERS } from '@/services/sms/providerCatalog';
import { getSmsConfigForAdmin } from '@/services/sms/smsConfigService';
import { AiProviderSettings } from '@/components/admin/AiProviderSettings';
import { AI_PROVIDERS } from '@/services/ai/aiProviderCatalog';
import { getAiConfigForAdmin } from '@/services/ai/aiConfigService';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Integrations. Provider-agnostic SMS and AI configuration.
 * The current config is loaded server-side (no secret plaintext is ever sent to
 * the browser — only non-secret values and "is set" flags). Admin-only via the
 * (dashboard) layout guard.
 */
export default async function IntegrationsPage() {
  const [smsConfig, aiConfig] = await Promise.all([
    getSmsConfigForAdmin(),
    getAiConfigForAdmin(),
  ]);

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <Link href="/admin/settings" className="text-sm font-semibold text-brand-700 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Integrations</h1>
        <p className="text-ink-muted">
          External services SiteComply connects to. Secret values are stored
          encrypted and never shown again.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-ink">SMS</h2>
          <p className="text-sm text-ink-muted">
            Provider used to send worker sign-in verification codes.
          </p>
        </div>
        <SmsProviderSettings providers={SMS_PROVIDERS} config={smsConfig} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Artificial intelligence</h2>
          <p className="text-sm text-ink-muted">
            Provider and feature settings for AI-generated report, audit and
            action summaries.
          </p>
        </div>
        <AiProviderSettings providers={AI_PROVIDERS} config={aiConfig} />
      </section>
    </div>
  );
}
