import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { SiteForm } from '@/components/platform/SiteForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { canEditSite } from '@/services/platformUsers/platformPermissions';
import { getSiteForEditByViewer } from '@/services/sites/platformSiteService';

export const dynamic = 'force-dynamic';

/**
 * Platform → Edit site. Director-only, and only for a site within the viewer's
 * scope (the loader returns null → 404 otherwise, preserving site-scoping). Both
 * the page and the API enforce the gate; the API is the security boundary.
 */
export default async function EditSitePage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canEditSite(viewer.role)) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const site = await getSiteForEditByViewer(viewer, params.id);
  if (!site) notFound();

  return (
    <PlatformShell>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: 'Sites', href: '/platform/dashboard/sites' },
            {
              label: site.name,
              href: `/platform/dashboard/sites/${site.id}`,
            },
            { label: 'Edit' },
          ]}
        />
        <Link
          href={`/platform/dashboard/sites/${site.id}`}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Back to site
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Edit site</h1>
        <p className="text-ink-muted">
          Update this site&rsquo;s details, address or status. Changes take
          effect immediately across check-ins, reporting, audits, actions and
          documents.
        </p>
      </div>

      <SiteForm
        mode="edit"
        siteId={site.id}
        initial={{
          name: site.name,
          jobReference: site.jobReference,
          status: site.status,
          addressLine1: site.addressLine1,
          addressLine2: site.addressLine2 ?? '',
          town: site.town,
          postcode: site.postcode,
          fireAssemblyPoint: site.fireAssemblyPoint ?? '',
          firstAiderName: site.firstAiderName ?? '',
          firstAiderNumber: site.firstAiderNumber ?? '',
          firstAiderLocation: site.firstAiderLocation ?? '',
          nearestHospital: site.nearestHospital ?? '',
          emergencyNumber: site.emergencyNumber ?? '',
          inductionContent: site.inductionContent,
        }}
      />
    </PlatformShell>
  );
}
