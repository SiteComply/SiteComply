import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getDocumentForViewer } from '@/services/documents/documentService';
import {
  documentCategoryLabel,
  formatBytes,
  documentExpiryStatus,
  DOCUMENT_EXPIRY_LABEL,
  DOCUMENT_EXPIRY_BADGE,
} from '@/services/documents/documentConstants';
import { DocumentDeleteButton } from '@/components/platform/DocumentDeleteButton';
import { formatDateUK, formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Document detail — metadata, site, uploader and a download action. Only
 * reachable for documents within the viewer's scope (site boundary enforced in
 * the service). Edit is shown to roles with the documents "edit" permission.
 */
export default async function DocumentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'documents');

  const doc = await getDocumentForViewer(viewer, params.id);
  if (!doc) notFound();

  const canEdit = permits(viewer.role, 'documents', 'edit');
  const expiryStatus = documentExpiryStatus(doc.expiresAt);

  return (
    <PlatformShell>
      <div className="mb-6">
        <Link
          href="/platform/dashboard/documents"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Documents
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-ink">{doc.title}</h1>
              {expiryStatus !== 'NONE' && (
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${DOCUMENT_EXPIRY_BADGE[expiryStatus]}`}
                >
                  {DOCUMENT_EXPIRY_LABEL[expiryStatus]}
                </span>
              )}
            </div>
            <p className="text-ink-muted">
              {documentCategoryLabel(doc.category)} · {doc.jobSite.name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canEdit && (
              <Link
                href={`/platform/dashboard/documents/${doc.id}/edit`}
                className="rounded-xl border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Edit details
              </Link>
            )}
            <a
              href={`/api/platform/documents/${doc.id}/download`}
              className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
            >
              Download
            </a>
            {canEdit && (
              <DocumentDeleteButton documentId={doc.id} title={doc.title} />
            )}
          </div>
        </div>
      </div>

      {doc.description && (
        <p className="mb-6 max-w-2xl whitespace-pre-line text-ink">
          {doc.description}
        </p>
      )}

      <dl className="grid max-w-2xl gap-x-8 gap-y-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
        <Detail label="Category" value={documentCategoryLabel(doc.category)} />
        <Detail
          label="Site"
          value={`${doc.jobSite.name} · ${doc.jobSite.jobReference}`}
        />
        <Detail
          label="Expiry"
          value={doc.expiresAt ? formatDateUK(doc.expiresAt) : 'No expiry'}
        />
        <Detail label="File name" value={doc.fileName} />
        <Detail label="File size" value={formatBytes(doc.sizeBytes)} />
        <Detail label="Type" value={doc.mimeType} />
        <Detail label="Uploaded by" value={doc.uploadedByName ?? 'Unknown'} />
        <Detail label="Uploaded" value={formatDateTimeUK(doc.createdAt)} />
        {doc.updatedAt.getTime() !== doc.createdAt.getTime() && (
          <Detail label="Last updated" value={formatDateTimeUK(doc.updatedAt)} />
        )}
      </dl>
    </PlatformShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}
