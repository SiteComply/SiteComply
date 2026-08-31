import Link from 'next/link';
import { cn } from '@/lib/cn';
import { formatDateTimeUK, formatHoursMinutes } from '@/lib/datetime';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PageHeader } from '@/components/platform/PageHeader';
import { SegmentedNav } from '@/components/platform/navUi';
import {
  WorkSurface,
  RailDetail,
  selectedRowClass,
  resolveSelected,
} from '@/components/platform/WorkSurface';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  CHECKIN_STATUS_FILTERS,
  parseCheckinStatusFilter,
  parseCheckinSiteFilter,
  checkinFilterHref,
  type CheckinStatusFilter,
} from '@/services/submissions/checkinFilter';
import { SiteFilterSelect } from '@/components/platform/SiteFilterSelect';
import { PaginationControls } from '@/components/platform/PaginationControls';
import {
  parseCheckinSort,
  nextSortFor,
  checkinSortParams,
  CHECKIN_COLUMNS,
} from '@/services/submissions/checkinSort';
import { resolvePage } from '@/lib/pagination';
import { canOverrideCheckOut } from '@/services/platformUsers/platformPermissions';
import {
  durationIsMeaningful,
  daysOpen,
} from '@/services/submissions/manualCheckOut';
import { ManualCheckOutNote } from '@/components/platform/ManualCheckOutNote';
import { ManualCheckOutPanel } from '@/components/platform/ManualCheckOutPanel';
import {
  getCheckinCounts,
  listCheckinsForViewer,
} from '@/services/submissions/checkinListService';

export const dynamic = 'force-dynamic';

/**
 * Platform → Check-ins. Lists worker site check-in records for the viewer's
 * accessible sites only, with All / On site / Checked out status filter tabs
 * (default All) carrying live, viewer-scoped counts — mirroring the Sites status
 * filter. The Export button follows the RBAC check-ins export permission (hidden
 * for Engineer and Client) and exports the filtered set in the order on screen.
 * (The route path stays /submissions to preserve existing URLs/bookmarks.)
 */
/**
 * The sort indicator. Only the ACTIVE column shows a solid arrow; the others
 * reveal a faint one on hover or keyboard focus, which says "this is sortable"
 * without putting four arrows in a four-column header and letting none of them
 * mean anything. Decorative — the heading already carries `aria-sort`.
 */
function SortArrow({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  const up = active ? dir === 'asc' : true;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        'h-3 w-3 shrink-0 transition-opacity',
        active
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-40 group-focus-visible:opacity-40',
      )}
    >
      {up ? (
        <>
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </>
      ) : (
        <>
          <path d="M12 5v14" />
          <path d="M19 12l-7 7-7-7" />
        </>
      )}
    </svg>
  );
}

export default async function PlatformSubmissionsPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    item?: string;
    site?: string;
    page?: string;
    sort?: string;
    dir?: string;
  };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'checkins');

  const canExport = permits(viewer.role, 'checkins', 'export');
  const status = parseCheckinStatusFilter(searchParams.status);
  // Unrecognised ?sort / ?dir fall back to the default rather than erroring, so
  // a mangled or stale shared link still renders a sensible table.
  const sort = parseCheckinSort(searchParams.sort, searchParams.dir);
  // Validated against the viewer's own sites; anything else → All Sites.
  const siteId = parseCheckinSiteFilter(searchParams.site, viewer.siteIds);

  // `counts` is narrowed by the chosen site so the tab pills describe the list
  // on screen. `orgTotal` is the UNFILTERED total, and decides only one thing:
  // whether this organisation has any check-ins at all. Without it, filtering to
  // a site with no check-ins made counts.all 0, which took the whole page down
  // the "nothing recorded yet" branch — hiding the filters and leaving no way
  // back to All Sites except editing the URL. One extra count, and only when a
  // site filter is actually applied.
  const [counts, orgTotal] = await Promise.all([
    getCheckinCounts(viewer, siteId),
    siteId ? getCheckinCounts(viewer).then((c) => c.all) : Promise.resolve(null),
  ]);
  const hasAnyCheckins = (orgTotal ?? counts.all) > 0;
  const basePath = '/platform/dashboard/submissions';

  const countByFilter: Record<CheckinStatusFilter, number> = {
    all: counts.all,
    'on-site': counts.onSite,
    'checked-out': counts.checkedOut,
  };

  // The row query now runs AFTER the counts rather than beside them, because the
  // page has to be clamped against a known total before we know which slice to
  // fetch — the same order Documents, Audits and Actions use. It costs one round
  // trip and buys the guarantee that `?page=999` can never render an empty table.
  //
  // The total is the count for the ACTIVE status filter, so "of N" always agrees
  // with the highlighted pill above. No extra query: both numbers come from the
  // getCheckinCounts call already made.
  const pg = resolvePage(searchParams.page, countByFilter[status]);
  const now = new Date();
  const submissions = await listCheckinsForViewer(viewer, status, siteId, {
    skip: pg.skip,
    take: pg.take,
    sort,
  });

  // Selection is resolved against the rows ACTUALLY returned for this viewer
  // and filter, so an id for a check-in outside their scope simply shows the
  // empty rail — it never confirms the record exists. It is now also scoped to
  // the current page, which is the same rule: a row you cannot see is not
  // selected.
  const selected = resolveSelected(searchParams.item, submissions);

  // Carried by both the row links and the pagination bar so paging keeps your
  // filters and selecting a row keeps your place in the list.
  const carriedParams = {
    status: status === 'all' ? undefined : status,
    site: siteId ?? undefined,
    // Sorting is part of "the list you are looking at", so it is carried by the
    // same mechanism as the filters: paging keeps it, and because the export
    // link is built from this object below, the CSV comes out in the order on
    // screen without a second place to keep in step.
    ...checkinSortParams(sort),
  };

  // The export gets the same two filters, so the CSV is the table. `page` is
  // deliberately NOT carried: the export is the whole filtered set, not one page.
  const exportQs = new URLSearchParams(
    Object.entries(carriedParams).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <PlatformShell>
      <PageHeader
        title="Check-ins"
        description="Worker site check-in and induction records across your sites."
        meta={
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
        }
        actions={
          <>
            {canExport && counts.all > 0 && (
              <a
                // Carries the active filters so the CSV matches the table.
                href={`/api/platform/submissions/export${exportQs ? `?${exportQs}` : ''}`}
                className="touch-target inline-flex items-center rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Export CSV
              </a>
            )}
          </>
        }
      />

      {!hasAnyCheckins ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
          No check-ins recorded for your sites yet.
        </p>
      ) : (
        <>
          {/* UX REFRESH PHASE 9 — the same recessed control the Sites register
              uses, from one definition. Both had independently grown the same
              markup as a card stacked above the table. Hrefs, statuses and counts
              are unchanged. */}
          {/* Status strip and site filter on one row: the same filter decision,
              so they sit together rather than stacking a second control band.
              The strip keeps its own bottom margin, so the row is aligned on the
              control tops. Both filters live in the URL and compose — picking a
              site keeps the status, and vice versa. */}
          <div className="flex flex-wrap items-start justify-between gap-x-3">
            <SegmentedNav
              label="Filter check-ins by status"
              items={CHECKIN_STATUS_FILTERS.map((f) => ({
                key: f.value,
                label: f.label,
                href: checkinFilterHref(basePath, f.value, siteId, sort),
                active: f.value === status,
                count: countByFilter[f.value],
              }))}
            />
            {viewer.sites.length > 1 && (
              <SiteFilterSelect
                label="Filter check-ins by site"
                sites={viewer.sites.map((s) => ({ id: s.id, name: s.name }))}
                selectedSiteId={siteId}
                basePath={basePath}
                preserveParams={{
                  status: status === 'all' ? undefined : status,
                  ...checkinSortParams(sort),
                }}
              />
            )}
          </div>

          {/* UX REFRESH PHASE 5 — this was the last register still rendering one
              bordered card per row: literally card, card, card. It is now a work
              surface — a table to scan, and a rail carrying the selected
              check-in's detail.

              The row used to navigate straight to the worker's record, which
              meant losing your filtered list to answer "when did they check
              out?". Selecting a row now answers that in place; the worker record
              is still one click away from the rail. */}
          {submissions.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
              {/* Names the site when one is chosen, so an empty table reads as
                  "this filter has no rows" rather than "there is no data". */}
              {siteId
                ? status === 'on-site'
                  ? 'No workers are currently on site at this site.'
                  : status === 'checked-out'
                    ? 'No checked-out check-ins for this site.'
                    : 'No check-ins for this site.'
                : status === 'on-site'
                  ? 'No workers are currently on site.'
                  : status === 'checked-out'
                    ? 'No checked-out check-ins.'
                    : 'No check-ins to show.'}
            </p>
          ) : (
            /* UX REFRESH PHASE 10 — see WorkSurface: the rail is a consequence
               of selection, so only the selected title renders. */
            <WorkSurface
              railTitle="Check-in"
              railEmpty="Select a check-in to see its details."
              // The shared bar Documents, Audits and Actions already use:
              // "Showing X–Y of N" plus Previous / Next. `item` is carried so
              // paging does not silently clear the rail selection.
              footer={
                <PaginationControls
                  basePath={basePath}
                  params={{ ...carriedParams, item: searchParams.item }}
                  pg={pg}
                />
              }
              rail={
                selected && (
                  <>
                    <p className="text-base font-semibold text-ink">
                      {selected.worker.fullName}
                    </p>
                    <p className="mb-2 text-sm text-ink-subtle">
                      {selected.worker.company}
                    </p>
                    <dl>
                      <RailDetail label="Site" value={selected.jobSite.name} />
                      <RailDetail
                        label="Status"
                        value={
                          selected.checkedOutAt ? 'Checked out' : 'On site now'
                        }
                      />
                      <RailDetail
                        label="Checked in"
                        value={formatDateTimeUK(selected.checkedInAt)}
                      />
                      <RailDetail
                        label="Checked out"
                        value={
                          selected.checkedOutAt ? (
                            <>
                              {formatDateTimeUK(selected.checkedOutAt)}
                              <ManualCheckOutNote row={selected} />
                            </>
                          ) : (
                            '— still on site'
                          )
                        }
                      />
                      {/* Derived from the two timestamps already loaded; no new
                          query, and it is the one figure the table cannot show
                          without becoming a wall of numbers. */}
                      <RailDetail
                        label="Time on site"
                        value={
                          // A manual close records when a MANAGER acted, not when
                          // the worker left, so the gap between the timestamps is
                          // not a shift. Publishing it would put a fabricated
                          // duration — sometimes weeks — into attendance.
                          !durationIsMeaningful(selected)
                            ? '— not measured (manual check-out)'
                            : selected.checkedOutAt
                              ? formatHoursMinutes(
                                  Math.max(
                                    0,
                                    Math.round(
                                      (selected.checkedOutAt.getTime() -
                                        selected.checkedInAt.getTime()) /
                                        60000,
                                    ),
                                  ),
                                )
                              : '—'
                        }
                      />
                    </dl>
                    {/* BL-001 — the action sits with the record it acts on, and
                        only for a role that may use it. The API re-checks. */}
                    {!selected.checkedOutAt &&
                    canOverrideCheckOut(viewer.role) ? (
                      <ManualCheckOutPanel
                        submissionId={selected.id}
                        workerName={selected.worker.fullName}
                        openSinceLabel={`Open since ${formatDateTimeUK(selected.checkedInAt)} · ${daysOpen(selected.checkedInAt, now)} days.`}
                      />
                    ) : null}
                    <Link
                      href={`/platform/dashboard/workers/${selected.worker.id}`}
                      className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
                    >
                      View worker record →
                    </Link>
                  </>
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-subtle">
                      {CHECKIN_COLUMNS.map((col) => {
                        const active = sort.key === col.key;
                        const next = nextSortFor(col.key, sort);
                        return (
                          <th
                            key={col.key}
                            scope="col"
                            className={cn(
                              'px-5 py-2.5 font-medium',
                              active && 'font-semibold text-ink',
                            )}
                            aria-sort={
                              active
                                ? sort.dir === 'asc'
                                  ? 'ascending'
                                  : 'descending'
                                : 'none'
                            }
                          >
                            {/*
                              `whitespace-nowrap` is load-bearing, not tidiness:
                              with the detail rail open the table can be narrow
                              enough that "Checked in" broke onto a second line
                              and took the sort arrow with it, leaving a ragged
                              header row. The wrapper is already overflow-x-auto,
                              so the table scrolls sideways instead — which is
                              how this surface has always handled being squeezed.

                              A link, not a button: this page is a server
                              component with no client state, so every ordering
                              is a real URL that can be shared, bookmarked and
                              opened in a new tab — and it works without JS.
                              checkinFilterHref carries the current filters and
                              deliberately drops `page`, so a sort always lands
                              on page 1 rather than page 4 of a set that has
                              just been reordered underneath you.
                            */}
                            <Link
                              href={checkinFilterHref(
                                basePath,
                                status,
                                siteId,
                                next,
                              )}
                              className="group inline-flex items-center gap-1.5 whitespace-nowrap rounded hover:text-ink"
                            >
                              {col.label}
                              <SortArrow active={active} dir={sort.dir} />
                            </Link>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {submissions.map((s) => {
                      const onSite = !s.checkedOutAt;
                      const isSelected = selected?.id === s.id;
                      return (
                        <tr
                          key={s.id}
                          className={selectedRowClass(isSelected)}
                          aria-current={isSelected ? 'true' : undefined}
                        >
                          <td className="px-5 py-3">
                            <Link
                              // Carries both active filters AND the current page,
                              // so selecting a row never drops the list you
                              // selected it from — or your place in it.
                              href={`${basePath}?${new URLSearchParams({
                                ...(status === 'all' ? {} : { status }),
                                ...(siteId ? { site: siteId } : {}),
                                // Without this the rail would open on a table
                                // silently reverted to the default order.
                                ...checkinSortParams(sort),
                                ...(pg.page > 1
                                  ? { page: String(pg.page) }
                                  : {}),
                                item: s.id,
                              }).toString()}`}
                              className="font-semibold text-brand-700 hover:underline"
                            >
                              {s.worker.fullName}
                            </Link>
                          </td>
                          <td className="px-5 py-3 text-ink">
                            {s.jobSite.name}
                          </td>
                          <td className="px-5 py-3">
                            <span
                              className={cn(
                                'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
                                onSite
                                  ? 'bg-safe-50 text-safe-700'
                                  : 'border border-line bg-surface-sunken text-ink-muted',
                              )}
                            >
                              {onSite ? 'On site' : 'Checked out'}
                            </span>
                          </td>
                          <td className="px-5 py-3 tabular-nums text-ink-muted">
                            {formatDateTimeUK(s.checkedInAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </WorkSurface>
          )}
        </>
      )}
    </PlatformShell>
  );
}
