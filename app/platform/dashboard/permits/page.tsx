import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PageHeader } from '@/components/platform/PageHeader';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  listPermitsForViewer,
  countPermitsForViewer,
} from '@/services/permits/permitAdminService';
import {
  PERMIT_STATUSES,
  permitStatusLabel,
  PERMIT_STATUS_BADGE,
} from '@/services/permits/permitConstants';
import { PaginationControls } from '@/components/platform/PaginationControls';
import { resolvePage } from '@/lib/pagination';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Permits to Work (SC-009) — the site-scoped register of permit requests. Shows
 * only permits for sites the viewer can access; filterable by status and site.
 * Permits awaiting a decision surface first via the notifications badge.
 */
export default async function PlatformPermitsPage({
  searchParams,
}: {
  searchParams: { status?: string; site?: string; q?: string; page?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'permits');

  const status = searchParams.status ?? '';
  const site = searchParams.site ?? '';
  const q = (searchParams.q ?? '').trim();
  const filters = {
    status: status || undefined,
    siteId: site || undefined,
    search: q || undefined,
  };
  const total = await countPermitsForViewer(viewer, filters);
  const pg = resolvePage(searchParams.page, total);
  const rows = await listPermitsForViewer(viewer, {
    ...filters,
    skip: pg.skip,
    take: pg.take,
  });

  return (
    <PlatformShell>
      <PageHeader
        title="Permits to Work"
        description="Permit requests raised by workers across your sites."
        meta={
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
        }
      />

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
            placeholder="Reference, type or worker…"
            className="w-56 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Status</span>
          <select
            name="status"
            defaultValue={status}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">All statuses</option>
            {PERMIT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
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

        <button
          type="submit"
          className="rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          Apply
        </button>
        {(status || site || q) && (
          <Link
            href="/platform/dashboard/permits"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            Clear
          </Link>
        )}
      </form>

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {viewer.siteIds.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            You have no sites assigned yet, so there are no permits to show.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            No permits
            {status ? ` with status “${permitStatusLabel(status)}”` : ''} for
            your sites yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Reference</th>
                  <th className="px-5 py-2.5 font-medium">Type</th>
                  <th className="px-5 py-2.5 font-medium">Worker</th>
                  <th className="px-5 py-2.5 font-medium">Site</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-brand-50/30">
                    <td className="px-5 py-3">
                      <Link
                        href={`/platform/dashboard/permits/${p.id}`}
                        className="font-mono font-semibold text-brand-700 hover:underline"
                      >
                        {p.reference}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink">{p.permitTypeName}</td>
                    <td className="px-5 py-3 text-ink">{p.workerName}</td>
                    <td className="px-5 py-3 text-ink-muted">{p.siteName}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${PERMIT_STATUS_BADGE[p.status]}`}
                      >
                        {p.statusLabel}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">
                      {formatDateTimeUK(p.submittedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <PaginationControls
            basePath="/platform/dashboard/permits"
            params={{ status, site, q }}
            pg={pg}
          />
        )}
      </section>
    </PlatformShell>
  );
}
