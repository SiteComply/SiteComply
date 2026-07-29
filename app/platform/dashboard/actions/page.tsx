import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PlatformIcon } from '@/components/platform/icons';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { canUseAiSummaries } from '@/services/ai/aiConfig';
import { AiSummaryPanel } from '@/components/platform/AiSummaryPanel';
import {
  listActions,
  actionCounts,
  countActions,
} from '@/services/actions/actionService';
import {
  ACTION_BUCKETS,
  ACTION_PRIORITIES,
  actionPriorityLabel,
  actionStatusLabel,
  ACTION_PRIORITY_BADGE,
  ACTION_STATUS_BADGE,
  ACTION_OVERDUE_BADGE,
  isActionBucket,
  type ActionPriorityValue,
  type ActionStatusValue,
} from '@/services/actions/actionConstants';
import { PaginationControls } from '@/components/platform/PaginationControls';
import { resolvePage } from '@/lib/pagination';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Actions register — the central, site-scoped list of corrective actions across
 * the viewer's sites, bucketed into Open / In progress / Overdue / Completed.
 * "Overdue" is derived (open or in-progress with a past due date).
 */
export default async function PlatformActionsPage({
  searchParams,
}: {
  searchParams: {
    bucket?: string;
    site?: string;
    priority?: string;
    q?: string;
    page?: string;
  };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'actions');

  const now = new Date();
  const bucket =
    searchParams.bucket && isActionBucket(searchParams.bucket)
      ? searchParams.bucket
      : '';
  const site = searchParams.site ?? '';
  const priority = searchParams.priority ?? '';
  const q = (searchParams.q ?? '').trim();
  const filters = {
    bucket: bucket || undefined,
    siteId: site || undefined,
    priority: priority || undefined,
    search: q || undefined,
  };

  const [total, counts] = await Promise.all([
    countActions(viewer, filters, now),
    actionCounts(viewer, now),
  ]);
  const pg = resolvePage(searchParams.page, total);
  const actions = await listActions(
    viewer,
    { ...filters, skip: pg.skip, take: pg.take },
    now,
  );
  const canCreate = permits(viewer.role, 'actions', 'create');
  const showAiSummary = await canUseAiSummaries(viewer.role);

  const qp = (patch: Record<string, string>) => {
    const sp = new URLSearchParams();
    // Changing a bucket resets to page 1 (page is intentionally not carried here).
    const merged = { bucket, site, priority, q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return `/platform/dashboard/actions${s ? `?${s}` : ''}`;
  };

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Actions</h1>
          <p className="text-ink-muted">
            Central register of corrective actions across your sites.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
          {canCreate && (
            <Link
              href="/platform/dashboard/actions/new"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
            >
              <PlatformIcon name="bolt" />
              New action
            </Link>
          )}
        </div>
      </header>

      {showAiSummary && <AiSummaryPanel targetType="ACTIONS_REGISTER" />}

      {/* Register buckets — clickable summary cards that filter the list. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {ACTION_BUCKETS.map((b) => {
          const active = bucket === b.value;
          const overdue = b.value === 'OVERDUE';
          return (
            <Link
              key={b.value}
              href={qp({ bucket: active ? '' : b.value })}
              className={cardClass(active, overdue)}
            >
              <span className="text-sm font-medium">{b.label}</span>
              <span className="mt-1 text-2xl font-bold tabular-nums">
                {counts[b.value]}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Secondary filters (site, priority). */}
      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
      >
        {bucket && <input type="hidden" name="bucket" value={bucket} />}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Title or assignee…"
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
            <option value="">All my sites</option>
            {viewer.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.jobReference}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Priority</span>
          <select
            name="priority"
            defaultValue={priority}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">All priorities</option>
            {ACTION_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
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
        {(bucket || site || priority || q) && (
          <Link
            href="/platform/dashboard/actions"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            Clear
          </Link>
        )}
      </form>

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {viewer.siteIds.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            You have no sites assigned yet, so there are no actions to show.
          </p>
        ) : actions.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            No actions
            {bucket
              ? ` in “${ACTION_BUCKETS.find((b) => b.value === bucket)?.label}”`
              : ''}{' '}
            for your sites.
            {canCreate && ' Use “New action” to add one.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Action</th>
                  <th className="px-5 py-2.5 font-medium">Site</th>
                  <th className="px-5 py-2.5 font-medium">Priority</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Due</th>
                  <th className="px-5 py-2.5 font-medium">Assigned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {actions.map((a) => {
                  const overdue =
                    a.status !== 'COMPLETED' && a.dueDate && a.dueDate < now;
                  return (
                    <tr key={a.id} className="hover:bg-brand-50/30">
                      <td className="px-5 py-3">
                        <Link
                          href={`/platform/dashboard/actions/${a.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {a.title}
                        </Link>
                        {a.auditFindingId && (
                          <span className="ml-2 text-xs text-ink-subtle">
                            · from audit
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-ink">{a.jobSite.name}</td>
                      <td className="px-5 py-3">
                        <Badge
                          className={
                            ACTION_PRIORITY_BADGE[
                              a.priority as ActionPriorityValue
                            ]
                          }
                        >
                          {actionPriorityLabel(a.priority)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            className={
                              ACTION_STATUS_BADGE[a.status as ActionStatusValue]
                            }
                          >
                            {actionStatusLabel(a.status)}
                          </Badge>
                          {overdue && (
                            <Badge className={ACTION_OVERDUE_BADGE}>
                              Overdue
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td
                        className={`px-5 py-3 ${overdue ? 'font-semibold text-danger-700' : 'text-ink-muted'}`}
                      >
                        {a.dueDate ? formatDateUK(a.dueDate) : '—'}
                      </td>
                      <td className="px-5 py-3 text-ink-muted">
                        {a.assignedTo ? (
                          <>
                            <span className="text-ink">{a.assignedTo}</span>
                            {a.assignedToCompany && (
                              <span className="block text-xs text-ink-subtle">
                                {a.assignedToCompany}
                              </span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <PaginationControls
            basePath="/platform/dashboard/actions"
            params={{ bucket, site, priority, q }}
            pg={pg}
          />
        )}
      </section>
    </PlatformShell>
  );
}

function cardClass(active: boolean, overdue: boolean): string {
  const base =
    'flex flex-col rounded-xl border p-4 shadow-card transition-colors ';
  if (active)
    return (
      base +
      (overdue
        ? 'border-danger-600 bg-danger-50 text-danger-700'
        : 'border-brand-500 bg-brand-50 text-brand-700')
    );
  return (
    base +
    (overdue
      ? 'border-line bg-surface text-danger-700 hover:border-danger-300'
      : 'border-line bg-surface text-ink hover:border-brand-200')
  );
}

function Badge({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}
