import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { ArrangementsEditor } from '@/components/platform/ArrangementsEditor';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { prisma } from '@/lib/prisma';
import { resolveArrangements } from '@/services/sites/arrangementService';

export const dynamic = 'force-dynamic';

/**
 * CPP Tier 3A — this site's management arrangements.
 *
 * Shows what the site inherits from the company standard, and lets a site
 * manager write a site-specific version of any arrangement that genuinely
 * differs here. The Construction Phase Plan labels which is which.
 */
export default async function SiteArrangementsPage({
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

  const arrangements = await resolveArrangements(site.id);
  const overrides = arrangements.filter((a) => a.source === 'SITE').length;
  const missing = arrangements.filter((a) => a.source === 'NONE').length;

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Sites', href: '/platform/dashboard/sites' },
          { label: site.name, href: `/platform/dashboard/sites/${site.id}` },
          { label: 'Management arrangements' },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Management arrangements</h1>
          <p className="text-sm text-ink-muted">
            {overrides} site-specific · {arrangements.length - overrides - missing}{' '}
            using the company standard
            {missing > 0 ? ` · ${missing} not recorded` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/platform/dashboard/settings/arrangements"
            className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Company standards
          </Link>
          <Link
            href={`/platform/dashboard/sites/${site.id}/cpp`}
            className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            View the plan
          </Link>
        </div>
      </div>

      <ArrangementsEditor
        level="SITE"
        endpoint={`/api/platform/sites/${site.id}/arrangements`}
        canEdit={permits(viewer.role, 'sites', 'edit')}
        initial={arrangements.map((a) => ({
          key: a.key,
          content: a.content,
          standardContent: a.standardContent,
          source: a.source,
        }))}
      />
    </PlatformShell>
  );
}
