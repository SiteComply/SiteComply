import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteForm } from '@/components/admin/SiteForm';
import { getSiteById } from '@/services/sites/adminSiteService';

export const dynamic = 'force-dynamic';

/** Edit an existing job site. */
export default async function EditSitePage({
  params,
}: {
  params: { id: string };
}) {
  const site = await getSiteById(params.id);
  if (!site) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/sites"
          className="text-sm font-semibold text-brand-700"
        >
          ← Back to job sites
        </Link>
        <h1 className="text-2xl font-bold text-ink">Edit site</h1>
        <p className="text-ink-muted">
          {site.name} · {site.jobReference}
        </p>
        <p className="text-sm text-ink-subtle">
          Edit the induction checklist from the{' '}
          <Link
            href={`/admin/sites/${site.id}/checklist`}
            className="font-semibold text-brand-700"
          >
            checklist builder
          </Link>
          .
        </p>
      </header>

      <SiteForm
        mode="edit"
        siteId={site.id}
        initial={{
          name: site.name,
          jobReference: site.jobReference,
          addressLine1: site.addressLine1,
          addressLine2: site.addressLine2 ?? '',
          town: site.town,
          postcode: site.postcode,
          inductionContent: site.inductionContent,
          fireAssemblyPoint: site.fireAssemblyPoint ?? '',
          firstAiderName: site.firstAiderName ?? '',
          firstAiderNumber: site.firstAiderNumber ?? '',
        }}
      />
    </div>
  );
}
