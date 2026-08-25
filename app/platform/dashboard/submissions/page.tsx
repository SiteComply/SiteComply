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
 * for Engineer and Client) and exports the full scoped set regardless of filter.
 * (The route path stays /submissions to preserve existing URLs/bookmarks.)
 */
export default async function PlatformSubmissionsPage({
  searchParams,
}: {
  searchParams: { status?: string; item?: string; site?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'checkins');

  const canExport = permits(viewer.role, 'checkins', 'export');
  const status = parseCheckinStatusFilter(searchParams.status);
  // Validated against the viewer's own sites; anything else → All Sites.
  const siteId = parseCheckinSiteFilter(searchParams.site, viewer.siteIds);

  // `counts` is narrowed by the chosen site so the tab pills describe the list
  // on screen. `orgTotal` is the UNFILTERED total, and decides only one thing:
  // whether this organisation has any check-ins at all. Without it, filtering to
  // a site with no check-ins made counts.all 0, which took the whole page down
  // the "nothing recorded yet" branch — hiding the filters and leaving no way
  // back to All Sites except editing the URL. One extra count, and only when a
  // site filter is actually applied.
  const [counts, submissions, orgTotal] = await Promise.all([
    getCheckinCounts(viewer, siteId),
    listCheckinsForViewer(viewer, status, siteId),
    siteId ? getCheckinCounts(viewer).then((c) => c.all) : Promise.resolve(null),
  ]);
  const hasAnyCheckins = (orgTotal ?? counts.all) > 0;

  // Selection is resolved against the rows ACTUALLY returned for this viewer
  // and filter, so an id for a check-in outside their scope simply shows the
  // empty rail — it never confirms the record exists.
  const selected = resolveSelected(searchParams.item, submissions);
  const basePath = '/platform/dashboard/submissions';

  const countByFilter: Record<CheckinStatusFilter, number> = {
    all: counts.all,
    'on-site': counts.onSite,
    'checked-out': counts.checkedOut,
  };

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
                href="/api/platform/submissions/export"
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
                href: checkinFilterHref(basePath, f.value, siteId),
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
                          selected.checkedOutAt
                            ? formatDateTimeUK(selected.checkedOutAt)
                            : '— still on site'
                        }
                      />
                      {/* Derived from the two timestamps already loaded; no new
                          query, and it is the one figure the table cannot show
                          without becoming a wall of numbers. */}
                      <RailDetail
                        label="Time on site"
                        value={
                          selected.checkedOutAt
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
                      <th className="px-5 py-2.5 font-medium">Worker</th>
                      <th className="px-5 py-2.5 font-medium">Site</th>
                      <th className="px-5 py-2.5 font-medium">Status</th>
                      <th className="px-5 py-2.5 font-medium">Checked in</th>
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
                              // Carries BOTH active filters, so selecting a row
                              // never drops the list you selected it from.
                              href={`${basePath}?${new URLSearchParams({
                                ...(status === 'all' ? {} : { status }),
                                ...(siteId ? { site: siteId } : {}),
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
                                'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
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
