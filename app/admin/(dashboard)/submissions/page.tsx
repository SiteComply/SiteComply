import Link from 'next/link';
import {
  querySubmissions,
  listSitesForFilter,
} from '@/services/submissions/submissionQueryService';
import { formatDateTimeUK } from '@/lib/datetime';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

interface SearchParams {
  site?: string;
  q?: string;
  from?: string;
  to?: string;
  status?: string;
}

/**
 * Submissions report: filter by site, worker and check-in date range, browse the
 * results, open a submission for full detail, or export the filtered set as CSV.
 */
export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const filters: SearchParams = {
    site: searchParams.site || undefined,
    q: searchParams.q || undefined,
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    status: searchParams.status || undefined,
  };

  const [sites, rows] = await Promise.all([
    listSitesForFilter(),
    querySubmissions(filters),
  ]);

  const exportQs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Submissions</h1>
        <p className="text-ink-muted">
          Search and filter check-in records, then open any record or export the
          results.
        </p>
      </header>

      {/* Server-rendered GET form — robust, no client JS required. */}
      <form
        method="get"
        className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Field label="Site">
          <select
            name="site"
            defaultValue={filters.site ?? ''}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.jobReference})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Worker or company">
          <input
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Search name or company"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink"
          />
        </Field>

        <Field label="From (DD/MM/YYYY)">
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ''}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink"
          />
        </Field>

        <Field label="To (DD/MM/YYYY)">
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ''}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink"
          />
        </Field>

        <Field label="Compliance">
          <select
            name="status"
            defaultValue={filters.status ?? ''}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink"
          >
            <option value="">Any</option>
            <option value="COMPLIANT">Compliant</option>
            <option value="INCOMPLETE">Incomplete</option>
          </select>
        </Field>

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
          <button
            type="submit"
            className="touch-target rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Apply filters
          </button>
          <Link
            href="/admin/submissions"
            className="touch-target inline-flex items-center rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            Clear
          </Link>
          <a
            href={`/api/admin/submissions/export${exportQs ? `?${exportQs}` : ''}`}
            className="touch-target ml-auto inline-flex items-center rounded-xl border border-brand-200 px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Export CSV
          </a>
        </div>
      </form>

      <p className="text-sm text-ink-subtle">
        {rows.length} {rows.length === 1 ? 'record' : 'records'} found.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          No submissions match these filters.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-line last:border-0">
              <Link
                href={`/admin/submissions/${r.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {r.worker.fullName}{' '}
                    <span className="font-normal text-ink-subtle">
                      · {r.worker.company}
                    </span>
                  </p>
                  <p className="truncate text-sm text-ink-subtle">
                    {r.jobSite.name} · {formatDateTimeUK(r.checkedInAt)}
                    {r.checkedOutAt
                      ? ` → ${formatDateTimeUK(r.checkedOutAt)}`
                      : ' · on site'}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    r.status === 'COMPLIANT'
                      ? 'bg-safe-50 text-safe-700'
                      : 'bg-danger-50 text-danger-700',
                  )}
                >
                  {r.status === 'COMPLIANT' ? 'Compliant' : 'Incomplete'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}
