import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import {
  TableSurface,
  TABLE_TOOLBAR_CLASS,
} from '@/components/platform/TableSurface';
import { PageHeader } from '@/components/platform/PageHeader';
import { SegmentedNav } from '@/components/platform/navUi';
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

  const qp = (patch: Record<string, string>) => {
    const sp = new URLSearchParams();
    // Changing status resets to page 1 (page is intentionally not carried here).
    const merged = { status, site, q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return `/platform/dashboard/permits${s ? `?${s}` : ''}`;
  };

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

      {/* Status is the axis a reviewer actually works along — "what is waiting
          on me" — so it gets the same recessed segmented strip the Actions and
          Sites registers use, rather than being one option inside a dropdown.
          Same filter, same query string, one fewer place to look. */}
      <SegmentedNav
        label="Filter permits by status"
        items={[
          // "All permits" leads the strip and is selected on first load. The
          // page ALREADY defaulted to every permit — `status` has always been
          // '' when absent — but nothing said so: no tab was highlighted and
          // "Awaiting approval" sat first, which read as the default view
          // without being it. This makes the existing default visible.
          //
          // Its href is the bare path, because dropping the parameter is what
          // "no status filter" has always meant here. Existing bookmarks and
          // the sidebar link keep working unchanged.
          {
            key: 'all',
            label: 'All permits',
            href: qp({ status: '' }),
            active: status === '',
          },
          ...PERMIT_STATUSES.map((s) => ({
            key: s.value,
            label: s.label,
            // No toggle. Clicking the active tab used to CLEAR the filter,
            // which was the only route back to the full register and was
            // invisible. "All permits" is that route now, so a tab does one
            // thing: select its own status.
            href: qp({ status: s.value }),
            active: status === s.value,
          })),
        ]}
      />

      {/* Remaining filters — a no-JS GET form (Apply to submit). */}
      <TableSurface>
        <form method="get" className={TABLE_TOOLBAR_CLASS}>
          {status && <input type="hidden" name="status" value={status} />}
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
            <span className="font-semibold text-ink">Site</span>
            <select
              name="site"
              defaultValue={site}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">All</option>
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
              {/* Same consolidation as the Actions register: the permit and what
                  it is for, then who asked and where, then its state, then when.
                  A reference on its own is not a subject — the permit type is
                  what a reviewer actually recognises, so it sits with it. */}
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Permit</th>
                  <th className="px-5 py-2.5 font-medium">Requested by</th>
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
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {p.permitTypeName}
                      </Link>
                      <span className="block font-mono text-xs text-ink-subtle">
                        {p.reference}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-ink">{p.workerName}</span>
                      <span className="block text-xs text-ink-subtle">
                        {p.siteName}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${PERMIT_STATUS_BADGE[p.status]}`}
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
      </TableSurface>
    </PlatformShell>
  );
}
