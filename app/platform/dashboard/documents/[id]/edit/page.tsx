import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { DocumentForm } from '@/components/platform/DocumentForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getDocumentForViewer } from '@/services/documents/documentService';

export const dynamic = 'force-dynamic';

/**
 * Edit a document's details and site assignment (not the file). Gated on the
 * documents "edit" permission; the site list is limited to the viewer's sites so
 * a document can only be reassigned within scope.
 */
export default async function EditDocumentPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'documents');
  if (!permits(viewer.role, 'documents', 'edit')) {
    redirect(`/platform/dashboard/documents/${params.id}`);
  }

  const doc = await getDocumentForViewer(viewer, params.id);
  if (!doc) notFound();

  // Offer active sites plus the document's current site (even if archived), so
  // it always has a valid selected value.
  const siteMap = new Map<
    string,
    { id: string; name: string; jobReference: string }
  >();
  for (const s of viewer.sites) {
    if (s.status === 'ACTIVE' || s.id === doc.jobSiteId) {
      siteMap.set(s.id, { id: s.id, name: s.name, jobReference: s.jobReference });
    }
  }

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link
          href={`/platform/dashboard/documents/${doc.id}`}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Back to document
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Edit document</h1>
        <p className="text-ink-muted">
          Update the details or reassign the document to another of your sites.
        </p>
      </div>

      <DocumentForm
        mode="edit"
        documentId={doc.id}
        sites={[...siteMap.values()]}
        initial={{
          title: doc.title,
          description: doc.description ?? '',
          category: doc.category,
          jobSiteId: doc.jobSiteId,
          // Pre-fill the date input in yyyy-mm-dd (UTC) form.
          expiresAt: doc.expiresAt ? doc.expiresAt.toISOString().slice(0, 10) : '',
        }}
        existingFile={{ fileName: doc.fileName, sizeBytes: doc.sizeBytes }}
      />
    </PlatformShell>
  );
}
