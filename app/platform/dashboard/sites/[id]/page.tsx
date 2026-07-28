import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { Section, Detail, Stat } from '@/components/platform/siteDetailUi';
import { formatDateUK } from '@/lib/datetime';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getSiteDetailForViewer } from '@/services/sites/siteDetailService';
import { pct } from '@/services/reports/complianceReport';

export const dynamic = 'force-dynamic';

/**
 * Platform → Site Details — Overview tab (the original Site Details URL). Site
 * information and an at-a-glance summary. Workers, compliance detail, worker
 * experience and documents live on their own tabs. Scope + per-section view
 * permissions are unchanged from the former single page.
 */
export default async function SiteOverviewPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const detail = await getSiteDetailForViewer(viewer, params.id);
  if (!detail) notFound();

  const { site, compliance } = detail;
  const canViewCheckins = permits(viewer.role, 'checkins', 'view');
  const compliantPct = pct(compliance.compliant, compliance.total);

  return (
    <PlatformShell>
      <SiteDetailHeader viewer={viewer} siteId={params.id} active="overview" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canViewCheckins && (
            <Section title="Site summary">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Check-ins" value={String(compliance.total)} />
                <Stat label="Compliant" value={`${compliantPct}%`} />
                <Stat label="On site now" value={String(detail.onSiteCount)} />
                <Stat
                  label="Incomplete"
                  value={String(compliance.incomplete)}
                />
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Site information">
            <dl className="space-y-3">
              <Detail label="Job reference" value={site.jobReference} />
              <Detail
                label="Address"
                value={`${site.addressLine1}, ${site.town}, ${site.postcode}`}
              />
              <Detail
                label="Status"
                value={site.status === 'ACTIVE' ? 'Active' : 'Archived'}
              />
              <Detail label="Created" value={formatDateUK(site.createdAt)} />
            </dl>
          </Section>
        </div>
      </div>
    </PlatformShell>
  );
}
