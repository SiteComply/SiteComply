import Link from 'next/link';
import { SmsProviderSettings } from '@/components/admin/SmsProviderSettings';
import { SmsActivityLog } from '@/components/admin/SmsActivityLog';
import { listRecentSms, smsUsageSummary } from '@/services/sms/smsSendService';
import { SMS_PROVIDERS } from '@/services/sms/providerCatalog';
import { getSmsConfigForAdmin } from '@/services/sms/smsConfigService';
import { AiProviderSettings } from '@/components/admin/AiProviderSettings';
import { AI_PROVIDERS } from '@/services/ai/aiProviderCatalog';
import { getAiConfigForAdmin } from '@/services/ai/aiConfigService';
import { CscsProviderSettings } from '@/components/admin/CscsProviderSettings';
import { getCscsConfigForAdmin } from '@/services/cscs/cscsConfigService';
import { AdminTabs, type AdminTab } from '@/components/admin/AdminTabs';
import { getAdminSession } from '@/lib/session';
import { adminCanManage } from '@/lib/adminAuth';
import { ReadOnlyBanner } from '@/components/admin/ReadOnlyBanner';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Integrations.
 *
 * A TABBED WORKSPACE, not one long page. Three integrations — SMS, CSCS Smart
 * Check and AI — each with its own provider settings, credentials and, for SMS,
 * an activity log. Stacked vertically that was a page nobody could see the
 * bottom of, and the AI settings sat below an SMS log fifty rows long.
 *
 * PRESENTATION ONLY. Every control, option, activity log and testing tool is
 * the same component with the same props as before; the only change is which
 * of them is on screen at once. No configuration behaviour, permission, storage
 * or integration logic is touched.
 *
 * The tab lives in the URL rather than in browser state so it can be linked to
 * and survives a reload — and so an error message elsewhere in the product can
 * point at exactly the right one (the CSCS provider's own refusal message names
 * this screen).
 *
 * Secret plaintext is still never sent to the browser: each config loader
 * returns non-secret values plus "is set" flags. Admin-only via the (dashboard)
 * layout guard; write actions additionally gated on `canManage`.
 */

const TABS: AdminTab[] = [
  { key: 'sms', label: 'SMS' },
  { key: 'cscs', label: 'CSCS Smart Check' },
  { key: 'ai', label: 'Artificial intelligence' },
];

const BASE = '/admin/settings/integrations';

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  // An unknown or absent tab falls back to the first rather than rendering an
  // empty workspace, so a stale bookmark still lands somewhere useful.
  const requested = searchParams?.tab ?? '';
  const active = TABS.some((t) => t.key === requested) ? requested : 'sms';

  // Loaded exactly as before — all three configs and the SMS log, in one
  // parallel batch. Deliberately NOT narrowed to the active tab: that would be
  // a behaviour change, and this release is presentation only.
  const [smsConfig, aiConfig, cscsConfig, smsLog, smsUsage] = await Promise.all([
    getSmsConfigForAdmin(),
    getAiConfigForAdmin(),
    getCscsConfigForAdmin(),
    listRecentSms(50),
    smsUsageSummary(),
  ]);
  const canManage = adminCanManage(getAdminSession()?.role);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/settings"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Integrations</h1>
        <p className="text-ink-muted">
          External services SiteComply connects to. Secret values are stored
          encrypted and never shown again.
        </p>
        <AdminTabs
          tabs={TABS}
          active={active}
          basePath={BASE}
          label="Integration settings"
        />
      </header>

      {!canManage && <ReadOnlyBanner />}

      {active === 'sms' ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-ink">SMS</h2>
            <p className="text-sm text-ink-muted">
              Provider used to send worker sign-in verification codes.
            </p>
          </div>
          <SmsProviderSettings
            providers={SMS_PROVIDERS}
            config={smsConfig}
            canManage={canManage}
          />
          <SmsActivityLog rows={smsLog} usage={smsUsage} />
        </section>
      ) : null}

      {active === 'cscs' ? (
        <section className="space-y-4">
          {/* No wrapper heading here, unlike SMS and AI. CscsProviderSettings
              renders its own <h2> and description; adding one above it printed
              "CSCS Smart Check" twice. The other two components render only
              their inner panel headings, so the page supplies theirs. */}
          <CscsProviderSettings config={cscsConfig} canManage={canManage} />
        </section>
      ) : null}

      {active === 'ai' ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-ink">
              Artificial intelligence
            </h2>
            <p className="text-sm text-ink-muted">
              Provider and feature settings for AI-generated report, audit and
              action summaries.
            </p>
          </div>
          <AiProviderSettings
            providers={AI_PROVIDERS}
            config={aiConfig}
            canManage={canManage}
          />
        </section>
      ) : null}
    </div>
  );
}
