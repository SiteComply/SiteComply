import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import {
  TableSurface,
  TABLE_TOOLBAR_CLASS,
} from '@/components/platform/TableSurface';
import { PageHeader } from '@/components/platform/PageHeader';
import { SegmentedNav } from '@/components/platform/navUi';
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
 * Priority as a dot rather than a second pill in the state cell. Derived from
 * the same four levels as ACTION_PRIORITY_BADGE, so the register and the detail
 * screen agree on what "critical" looks like.
 */
const PRIORITY_DOT: Record<ActionPriorityValue, string> = {
  LOW: 'bg-ink-subtle/40',
  MEDIUM: 'bg-hivis-400',
  HIGH: 'bg-danger-500',
  CRITICAL: 'bg-danger-600',
};

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
      <PageHeader
        title="Actions"
        description="Central register of corrective actions across your sites."
        meta={
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
        }
        actions={
          <>
            {canCreate && (
              <Link
                href="/platform/dashboard/actions/new"
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
              >
                <PlatformIcon name="bolt" />
                New action
              </Link>
            )}
          </>
        }
      />

      {showAiSummary && <AiSummaryPanel targetType="ACTIONS_REGISTER" />}

      {/* Register buckets. These are FILTERS, not statistics — each one narrows
          the list below — so they use the same recessed segmented control the
          Sites and Check-ins registers use, from one definition.

          They were four full-height cards with 2xl figures, stacked above the
          table's own card: two stacked surfaces for one list, and four boxes
          competing with the data they filter. The counts still show, the hrefs
          are unchanged, and clicking an active bucket still clears it. */}
      <SegmentedNav
        label="Filter actions by status"
        items={ACTION_BUCKETS.map((b) => ({
          key: b.value,
          label: b.label,
          href: qp({ bucket: bucket === b.value ? '' : b.value }),
          active: bucket === b.value,
          count: counts[b.value],
        }))}
      />

      {/* Secondary filters (site, priority). */}
      <TableSurface>
        <form method="get" className={TABLE_TOOLBAR_CLASS}>
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
              {/* Six columns of equal weight made every row a flat list of six
                  facts with no primary. The row already knew better in one
                  place — Assigned printed the name with the company beneath it —
                  so that pattern now runs throughout: the action and its site,
                  the state of it, when it is due, who has it. Same six facts,
                  four columns, one of them clearly the subject. */}
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Action</th>
                  <th className="px-5 py-2.5 font-medium">State</th>
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
                        <span className="block text-xs text-ink-subtle">
                          {a.jobSite.name}
                          {a.auditFindingId && ' · from audit'}
                        </span>
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
                        {/* Priority keeps its colour but drops the pill: two
                            filled badges in one cell compete, and the status is
                            the thing being scanned. Same palette, less weight. */}
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-subtle">
                          <span
                            aria-hidden="true"
                            className={`inline-block h-2 w-2 rounded-full ${PRIORITY_DOT[a.priority as ActionPriorityValue]}`}
                          />
                          {actionPriorityLabel(a.priority)} priority
                        </span>
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
      </TableSurface>
    </PlatformShell>
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
