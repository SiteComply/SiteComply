import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { SiteRiskRegister } from '@/components/platform/SiteRiskRegister';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { prisma } from '@/lib/prisma';
import { getRiskRegister } from '@/services/sites/cppRiskService';

export const dynamic = 'force-dynamic';

/**
 * CPP Tier 2 — significant risks and controls.
 *
 * Its own page rather than a tab on Operative experience: that tab is about what
 * an operative is shown, and this is about how the project is managed. The
 * Construction Phase Plan links here from both risk sections.
 */
export default async function SiteRisksPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  if (!permits(viewer.role, 'sites', 'view')) notFound();
  if (!viewer.siteIds.includes(params.id)) notFound();

  const site = await prisma.jobSite.findFirst({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!site) notFound();

  const register = await getRiskRegister(site.id);

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Sites', href: '/platform/dashboard/sites' },
          { label: site.name, href: `/platform/dashboard/sites/${site.id}` },
          { label: 'Significant risks' },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Significant risks</h1>
          <p className="text-sm text-ink-muted">
            Recorded once here, and printed in the Construction Phase Plan.
          </p>
        </div>
        <Link
          href={`/platform/dashboard/sites/${site.id}/cpp`}
          className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
        >
          View the plan
        </Link>
      </div>

      <SiteRiskRegister
        siteId={site.id}
        initial={register.rows}
        canEdit={permits(viewer.role, 'sites', 'edit')}
      />
    </PlatformShell>
  );
}
