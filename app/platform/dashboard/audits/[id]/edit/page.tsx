import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { AuditForm } from '@/components/platform/AuditForm';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  getAuditForViewer,
  listReferenceableDocuments,
} from '@/services/audits/auditService';

export const dynamic = 'force-dynamic';

/**
 * Edit an audit's details, site and referenced documents. Gated on the audits
 * "edit" permission; sites and documents are limited to the viewer's scope.
 */
export default async function EditAuditPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'audits');
  if (!permits(viewer.role, 'audits', 'edit')) {
    redirect(`/platform/dashboard/audits/${params.id}`);
  }

  const audit = await getAuditForViewer(viewer, params.id);
  if (!audit) notFound();

  // Offer active sites plus the audit's current site (even if archived).
  const siteMap = new Map<
    string,
    { id: string; name: string; jobReference: string }
  >();
  for (const s of viewer.sites) {
    if (s.status === 'ACTIVE' || s.id === audit.jobSiteId) {
      siteMap.set(s.id, {
        id: s.id,
        name: s.name,
        jobReference: s.jobReference,
      });
    }
  }
  const documents = await listReferenceableDocuments(viewer);

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link
          href={`/platform/dashboard/audits/${audit.id}`}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Back to audit
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Edit audit</h1>
        <p className="text-ink-muted">
          Update the audit details, site or referenced documents.
        </p>
      </div>

      <AuditForm
        mode="edit"
        auditId={audit.id}
        sites={[...siteMap.values()]}
        documents={documents}
        initial={{
          title: audit.title,
          jobSiteId: audit.jobSiteId,
          description: audit.description ?? '',
          observations: audit.observations ?? '',
          overallScore:
            audit.overallScore === null ? '' : String(audit.overallScore),
          documentIds: audit.documents.map((d) => d.id),
        }}
      />
    </PlatformShell>
  );
}
