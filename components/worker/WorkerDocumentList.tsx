import { cn } from '@/lib/cn';
import { formatDateUK } from '@/lib/datetime';
import {
  documentCategoryLabel,
  documentExpiryStatus,
  formatBytes,
  DOCUMENT_EXPIRY_BADGE,
  DOCUMENT_EXPIRY_LABEL,
} from '@/services/documents/documentConstants';
import type { WorkerDocument } from '@/services/workerDashboard/workerDashboardService';
import { WorkerIcon } from './icons';

/**
 * Read-only document list for the Worker Dashboard (SC-003), shared by the RAMS
 * and Site documents pages.
 *
 * Workers get metadata plus a download link and nothing else — no upload, edit
 * or delete affordances. Expiry is surfaced with the same badges the Platform
 * uses so "Expired" means the same thing to a worker and a manager.
 */
export function WorkerDocumentList({
  documents,
  showCategory = true,
  emptyMessage,
}: {
  documents: WorkerDocument[];
  showCategory?: boolean;
  emptyMessage: string;
}) {
  if (documents.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-subtle shadow-card">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {documents.map((doc) => {
        const expiry = documentExpiryStatus(doc.expiresAt);
        return (
          <li
            key={doc.id}
            className="rounded-xl border border-line bg-surface p-4 shadow-card"
          >
            <div className="flex flex-wrap items-center gap-2">
              {showCategory && (
                <span className="whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                  {documentCategoryLabel(doc.category)}
                </span>
              )}
              {expiry !== 'NONE' && (
                <span
                  className={cn(
                    'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
                    DOCUMENT_EXPIRY_BADGE[expiry],
                  )}
                >
                  {DOCUMENT_EXPIRY_LABEL[expiry]}
                </span>
              )}
            </div>

            <p className="mt-2 text-base font-semibold text-ink">{doc.title}</p>
            {doc.description && (
              <p className="mt-0.5 text-sm text-ink-muted">{doc.description}</p>
            )}
            <p className="mt-1 text-xs text-ink-subtle">
              {formatBytes(doc.sizeBytes)}
              {doc.expiresAt ? ` · Expires ${formatDateUK(doc.expiresAt)}` : ''}
            </p>

            <a
              href={`/api/worker/documents/${doc.id}/download`}
              className="touch-target mt-3 inline-flex items-center gap-2 rounded-lg border-2 border-brand-500 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              <WorkerIcon name="doc" className="h-4 w-4" />
              Open document
            </a>
          </li>
        );
      })}
    </ul>
  );
}
