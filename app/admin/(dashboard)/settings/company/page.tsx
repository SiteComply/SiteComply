import Link from 'next/link';
import { CompanySettings } from '@/components/admin/CompanySettings';
import { getCompanyConfigForAdmin } from '@/services/company/companyConfigService';

export const dynamic = 'force-dynamic';

/**
 * Admin → Settings → Company. Company name, support contacts, branding (colours
 * + tagline) and the company logo. Text/branding fields persist to the DB; the
 * logo is uploaded to the existing blob storage and streamed back via
 * /api/company/logo. Admin-only via the (dashboard) layout guard.
 */
export default async function CompanySettingsPage() {
  const config = await getCompanyConfigForAdmin();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin/settings" className="text-sm font-semibold text-brand-700 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-ink">Company</h1>
        <p className="text-ink-muted">
          Manage your organisation’s name, support contacts, branding and logo.
        </p>
      </header>

      <CompanySettings config={config} />
    </div>
  );
}
