import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PlatformIcon } from '@/components/platform/icons';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { listDocuments, countDocuments } from '@/services/documents/documentService';
import {
  DOCUMENT_CATEGORIES,
  documentCategoryLabel,
  formatBytes,
  DOCUMENT_EXPIRY_FILTERS,
} from '@/services/documents/documentConstants';
import { DocumentDeleteButton } from '@/components/platform/DocumentDeleteButton';
import { DocumentExpiryBadge } from '@/components/platform/DocumentExpiryBadge';
import { PaginationControls } from '@/components/platform/PaginationControls';
import { resolvePage } from '@/lib/pagination';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Documents library — the site-scoped document list. Shows only documents for
 * sites the viewer can access; filterable by category and site. Upload is shown
 * only to roles with the documents "create" permission.
 */
export default async function PlatformDocumentsPage({
  searchParams,
}: {
  searchParams: { category?: string; site?: string; expiry?: string; q?: string; page?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'documents');

  const category = searchParams.category ?? '';
  const site = searchParams.site ?? '';
  const expiry = searchParams.expiry ?? '';
  const q = (searchParams.q ?? '').trim();
  const filters = {
    category: category || undefined,
    siteId: site || undefined,
    expiry: expiry || undefined,
    search: q || undefined,
  };
  const total = await countDocuments(viewer, filters);
  const pg = resolvePage(searchParams.page, total);
  const documents = await listDocuments(viewer, { ...filters, skip: pg.skip, take: pg.take });
  const now = new Date();
  const canCreate = permits(viewer.role, 'documents', 'create');
  const canDelete = permits(viewer.role, 'documents', 'edit');

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Documents</h1>
          <p className="text-ink-muted">
            Method statements, RAMS, permits and site paperwork.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
          {canCreate && (
            <Link
              href="/platform/dashboard/documents/upload"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
            >
              <PlatformIcon name="doc" />
              Upload document
            </Link>
          )}
        </div>
      </header>

      {/* Filters — a no-JS GET form (Apply to submit). */}
      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Title or file name…"
            className="w-56 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Category</span>
          <select
            name="category"
            defaultValue={category}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">All categories</option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Site</span>
          <select
            name="site"
            defaultValue={site}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">All my sites</option>
            {viewer.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.jobReference}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Status</span>
          <select
            name="expiry"
            defaultValue={expiry}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">All statuses</option>
            {DOCUMENT_EXPIRY_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          Apply
        </button>
        {(category || site || expiry || q) && (
          <Link
            href="/platform/dashboard/documents"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            Clear
          </Link>
        )}
      </form>

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {viewer.siteIds.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            You have no sites assigned yet, so there are no documents to show.
          </p>
        ) : documents.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            No documents{category ? ` in ${documentCategoryLabel(category)}` : ''}{' '}
            for your sites yet.
            {canCreate && ' Use “Upload document” to add one.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Title</th>
                  <th className="px-5 py-2.5 font-medium">Category</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Site</th>
                  <th className="px-5 py-2.5 font-medium">Uploaded</th>
                  <th className="px-5 py-2.5 text-right font-medium">Size</th>
                  <th className="px-5 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {documents.map((d) => (
                  <tr key={d.id} className="hover:bg-brand-50/30">
                    <td className="px-5 py-3">
                      <Link
                        href={`/platform/dashboard/documents/${d.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {d.title}
                      </Link>
                      <div className="text-xs text-ink-subtle">{d.fileName}</div>
                    </td>
                    <td className="px-5 py-3 text-ink">
                      {documentCategoryLabel(d.category)}
                    </td>
                    <td className="px-5 py-3">
                      <DocumentExpiryBadge expiresAt={d.expiresAt} now={now} showDate />
                    </td>
                    <td className="px-5 py-3 text-ink">{d.jobSite.name}</td>
                    <td className="px-5 py-3 text-ink-muted">
                      {formatDateUK(d.createdAt)}
                      {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink-muted">
                      {formatBytes(d.sizeBytes)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`/api/platform/documents/${d.id}/download`}
                          className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
                        >
                          Download
                        </a>
                        {canDelete && (
                          <DocumentDeleteButton
                            documentId={d.id}
                            title={d.title}
                            variant="list"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <PaginationControls
            basePath="/platform/dashboard/documents"
            params={{ category, site, expiry, q }}
            pg={pg}
          />
        )}
      </section>
    </PlatformShell>
  );
}
