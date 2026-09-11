'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDateTimeUK } from '@/lib/datetime';

export interface ErrorRow {
  id: string;
  reference: string;
  kind: string;
  portal: string;
  digest: string | null;
  name: string | null;
  message: string;
  stack: string | null;
  pagePath: string | null;
  route: string | null;
  method: string | null;
  userName: string | null;
  userRole: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  buildId: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

const KIND_LABEL: Record<string, string> = {
  SERVER_ROUTE: 'API failure',
  SERVER_RENDER: 'Page failed on the server',
  CLIENT_RENDER: 'Page crashed in the browser',
  CLIENT_UNCAUGHT: 'Uncaught browser error',
  CLIENT_REJECTION: 'Unhandled promise rejection',
};

const PORTALS = ['PLATFORM', 'ADMIN', 'WORKER', 'PUBLIC', 'SYSTEM'];

/**
 * The error log.
 *
 * Rows are FAULTS, not occurrences: the same failure inside an hour folds into
 * one row with a count, so a page crash-looping reads as one problem seen 40
 * times rather than 40 problems.
 */
export function ErrorLogTable({
  rows,
  summary,
  filters,
  retentionDays,
  unavailable,
}: {
  rows: ErrorRow[];
  summary: { last24h: number; last7d: number; distinctFaults7d: number };
  filters: { portal: string | null; q: string; days: number };
  retentionDays: number;
  unavailable: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [open, setOpen] = useState<string | null>(null);

  function apply(next: Record<string, string | null>) {
    const p = new URLSearchParams(params?.toString() ?? '');
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
    }
    router.push(`/platform/dashboard/settings/errors?${p.toString()}`);
  }

  if (unavailable) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-base font-bold text-ink">Error log</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Error logging is not yet switched on for this environment. The database
          change that creates the log has not been applied.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {/* No heading here: SettingsWorkspace already renders the area's name and
          description, and adding another produced "Error log" twice. */}
      <p className="text-sm text-ink-muted">
        Not issues people reported — problems SiteComply hit on its own. Kept for{' '}
        {retentionDays} days, then deleted automatically.
      </p>

      <dl className="grid grid-cols-3 gap-3">
        {[
          ['Last 24 hours', summary.last24h],
          ['Last 7 days', summary.last7d],
          ['Distinct faults, 7 days', summary.distinctFaults7d],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              {label}
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply({ q });
          }}
          className="flex flex-1 gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Reference, code, message or page"
            aria-label="Search the error log"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <button
            type="submit"
            className="touch-target rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Search
          </button>
        </form>
        <select
          value={filters.portal ?? ''}
          onChange={(e) => apply({ portal: e.target.value || null })}
          aria-label="Filter by portal"
          className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
        >
          <option value="">All portals</option>
          {PORTALS.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <select
          value={String(filters.days)}
          onChange={(e) => apply({ days: e.target.value })}
          aria-label="Time range"
          className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
        >
          {[1, 7, 30, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} {d === 1 ? 'day' : 'days'}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-sunken p-6 text-sm text-ink-muted">
          Nothing logged in this period. That is the result you want.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Reference</th>
                <th className="w-[38%] px-4 py-3">What failed</th>
                <th className="px-4 py-3">Where</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3 text-right">Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted tabular-nums">
                    {formatDateTimeUK(new Date(r.lastSeenAt))}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                      className="font-semibold text-brand-700 hover:underline"
                      aria-expanded={open === r.id}
                    >
                      {r.reference}
                    </button>
                    {r.digest && (
                      <div className="text-xs text-ink-subtle">
                        code {r.digest}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">
                      {KIND_LABEL[r.kind] ?? r.kind}
                    </div>
                    <div className="text-ink-muted">{r.message}</div>
                    {open === r.id && (
                      <div className="mt-2 space-y-2">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-muted">
                          <div>
                            <dt className="inline font-semibold">Build: </dt>
                            <dd className="inline">{r.buildId ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">Device: </dt>
                            <dd className="inline">
                              {[r.browser, r.os, r.deviceType]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                              {r.viewportWidth
                                ? ` · ${r.viewportWidth}×${r.viewportHeight}`
                                : ''}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">First seen: </dt>
                            <dd className="inline">
                              {formatDateTimeUK(new Date(r.firstSeenAt))}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">Type: </dt>
                            <dd className="inline">{r.name ?? '—'}</dd>
                          </div>
                        </dl>
                        {r.stack ? (
                          <pre className="max-h-64 overflow-auto rounded-lg bg-surface-sunken p-3 text-xs leading-relaxed text-ink-muted">
                            {r.stack}
                          </pre>
                        ) : (
                          <p className="text-xs text-ink-subtle">
                            No stack: this failure began on the server, and the
                            browser only receives the reference code. Search the
                            server log for code {r.digest ?? '—'}.
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    <div>{r.route ?? r.pagePath ?? '—'}</div>
                    <div className="text-xs text-ink-subtle">
                      {r.method ? `${r.method} · ` : ''}
                      {r.portal.charAt(0) + r.portal.slice(1).toLowerCase()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.userName ?? 'Not signed in'}
                    {r.userRole && (
                      <div className="text-xs text-ink-subtle">{r.userRole}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {r.occurrences}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
