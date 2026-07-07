import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { DocumentForm } from '@/components/platform/DocumentForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';

export const dynamic = 'force-dynamic';

/**
 * Upload workflow — capture a document's details, category and site, then upload
 * the file. Gated on the documents "create" permission; the site list is limited
 * to sites the viewer can access.
 */
export default async function UploadDocumentPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'documents');
  if (!permits(viewer.role, 'documents', 'create')) {
    redirect('/platform/dashboard/documents');
  }

  const sites = viewer.sites
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => ({ id: s.id, name: s.name, jobReference: s.jobReference }));

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link
          href="/platform/dashboard/documents"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Documents
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Upload document</h1>
        <p className="text-ink-muted">
          Add a document to one of your sites. Set an optional expiry date for
          certificates, insurance or permits. Versioning comes in a later phase.
        </p>
      </div>

      {sites.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-5 py-10 text-center text-sm text-ink-subtle">
          You have no active sites to upload documents to.
        </p>
      ) : (
        <DocumentForm mode="upload" sites={sites} />
      )}
    </PlatformShell>
  );
}
