import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PageHeader } from '@/components/platform/PageHeader';
import { PlatformIcon } from '@/components/platform/icons';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  listAudits,
  countAudits,
  auditScoreLabel,
  auditResultLabel,
} from '@/services/audits/auditService';
import {
  AUDIT_STATUSES,
  auditStatusLabel,
  AUDIT_STATUS_BADGE,
  type AuditStatusValue,
} from '@/services/audits/auditConstants';
import { PaginationControls } from '@/components/platform/PaginationControls';
import { resolvePage } from '@/lib/pagination';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Audits list — the site-scoped register of audits. Shows only audits for sites
 * the viewer can access; filterable by status and site. "New audit" is shown
 * only to roles with the audits "create" permission.
 */
export default async function PlatformAuditsPage({
  searchParams,
}: {
  searchParams: { status?: string; site?: string; q?: string; page?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'audits');

  const status = searchParams.status ?? '';
  const site = searchParams.site ?? '';
  const q = (searchParams.q ?? '').trim();
  const filters = {
    status: status || undefined,
    siteId: site || undefined,
    search: q || undefined,
  };
  const total = await countAudits(viewer, filters);
  const pg = resolvePage(searchParams.page, total);
  const audits = await listAudits(viewer, {
    ...filters,
    skip: pg.skip,
    take: pg.take,
  });
  const canCreate = permits(viewer.role, 'audits', 'create');

  return (
    <PlatformShell>
      <PageHeader
        title="Audits"
        description="Site inspections and audit records across your sites."
        meta={
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
        }
        actions={
          <>
            <Link
              href="/platform/dashboard/audits/templates"
              className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
            >
              Templates
            </Link>
            {canCreate && (
              <Link
                href="/platform/dashboard/audits/new"
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
              >
                <PlatformIcon name="shield" />
                New audit
              </Link>
            )}
          </>
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
            placeholder="Audit title…"
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
            {AUDIT_STATUSES.map((s) => (
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
            href="/platform/dashboard/audits"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            Clear
          </Link>
        )}
      </form>

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {viewer.siteIds.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            You have no sites assigned yet, so there are no audits to show.
          </p>
        ) : audits.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            No audits
            {status ? ` with status “${auditStatusLabel(status)}”` : ''} for
            your sites yet.
            {canCreate && ' Use “New audit” to start one.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Title</th>
                  <th className="px-5 py-2.5 font-medium">Site</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Score</th>
                  <th className="px-5 py-2.5 font-medium">Result</th>
                  <th className="px-5 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {audits.map((a) => (
                  <tr key={a.id} className="hover:bg-brand-50/30">
                    <td className="px-5 py-3">
                      <Link
                        href={`/platform/dashboard/audits/${a.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {a.title}
                      </Link>
                      {a._count.documents > 0 && (
                        <span className="ml-2 text-xs text-ink-subtle">
                          · {a._count.documents} doc
                          {a._count.documents === 1 ? '' : 's'}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink">{a.jobSite.name}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          AUDIT_STATUS_BADGE[a.status as AuditStatusValue]
                        }`}
                      >
                        {auditStatusLabel(a.status)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink">
                      {auditScoreLabel(a)}
                    </td>
                    <td className="px-5 py-3">
                      {a.scoringEnabled && a.calculatedPassed !== null ? (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            a.calculatedPassed
                              ? 'bg-safe-50 text-safe-700'
                              : 'bg-danger-50 text-danger-700'
                          }`}
                        >
                          {auditResultLabel(a)}
                        </span>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-muted">
                      {formatDateUK(a.createdAt)}
                      {a.createdByName ? ` · ${a.createdByName}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <PaginationControls
            basePath="/platform/dashboard/audits"
            params={{ status, site, q }}
            pg={pg}
          />
        )}
      </section>
    </PlatformShell>
  );
}
