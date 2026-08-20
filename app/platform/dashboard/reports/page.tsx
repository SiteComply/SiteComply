import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PageHeader } from '@/components/platform/PageHeader';
import { PlatformIcon } from '@/components/platform/icons';
import { TableSurface, TableEmpty } from '@/components/platform/TableSurface';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
  type PlatformViewer,
} from '@/services/platformUsers/platformAccess';
import { getVisibleReports } from '@/services/reports/reportAccess';
import { getReportsLayout } from '@/services/reports/reportsLayout';
import type { ReportType } from '@/services/reports/reportRegistry';

export const dynamic = 'force-dynamic';

/**
 * Reports landing — the catalogue of report types this viewer may run,
 * filtered by role (Organisation Overview is Director-only) and shown with the
 * scope each one covers.
 *
 * A DIRECTORY, NOT A DASHBOARD. These were thirteen equal-weight cards in a
 * 3-column grid: dashboard furniture for things that are not dashboard
 * content. A report is a destination — you arrive knowing which one you want,
 * and the only questions are "is it the right one" and "how do I open it". A
 * row answers both in a line and fits the whole catalogue on one screen, where
 * the grid needed roughly three times the height for the same ten entries.
 *
 * The grid is retained verbatim below and is one App Service setting away
 * (REPORTS_LAYOUT=cards). Nothing about visibility, scope, routes or exports
 * differs between the two — only the framing.
 */
export default async function PlatformReportsPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'reports');

  const reports = getVisibleReports(viewer);
  const layout = getReportsLayout();

  return (
    <PlatformShell>
      <PageHeader
        title="Reports"
        description="Compliance and attendance reporting across your sites."
        meta={
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            {describeScope(viewer)}
          </span>
        }
      />

      {layout === 'cards' ? (
        <LegacyCardGrid reports={reports} />
      ) : (
        <ReportCatalogue reports={reports} viewer={viewer} />
      )}
    </PlatformShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Catalogue (default)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What each report covers, in the viewer's own terms.
 *
 * A Director-only report is organisation-wide by definition; everything else
 * runs over the sites this viewer holds, which is what `describeScope` already
 * says in the page header. Stating it per row matters because the two differ:
 * a Project Manager scanning the list should see at a glance that one of these
 * is not limited to their sites.
 */
function scopeLabel(report: ReportType, viewer: PlatformViewer): string {
  if (report.directorOnly) return 'Organisation-wide';
  if (viewer.allSites) return `All ${viewer.sites.length} sites`;
  const n = viewer.siteIds.length;
  return n === 0 ? 'No sites assigned' : `${n} assigned site${n === 1 ? '' : 's'}`;
}

/** Whether the rows name individuals, which decides who may export what. */
function dataLabel(report: ReportType, viewer: PlatformViewer): string {
  if (report.personalData && report.clientAggregateOnly && viewer.role === 'CLIENT') {
    return 'Aggregate only';
  }
  return report.personalData ? 'Personal data' : 'Aggregate';
}

function ReportCatalogue({
  reports,
  viewer,
}: {
  reports: ReportType[];
  viewer: PlatformViewer;
}) {
  if (reports.length === 0) {
    return (
      <TableSurface>
        <TableEmpty>
          There are no reports available to your role yet.
        </TableEmpty>
      </TableSurface>
    );
  }

  /* A LIBRARY, NOT A TABLE.
     The first catalogue put scope and data classification in their own
     columns, under headings, which gave two pieces of supporting metadata the
     same structural weight as the report itself — three headed columns to
     scan before reaching the thing you came for. They are now a single quiet
     line beneath the description, where they answer "is this the right one"
     without competing with "which one is it".

     Dropping the columns also drops the responsive rule that hid them below
     lg: an inline meta line wraps on its own, so there is one layout at every
     width instead of two. */
  return (
    <TableSurface>
      <ul className="divide-y divide-line">
        {reports.map((report) => {
          const href = `/platform/dashboard/reports/${report.id}`;
          return (
            <li
              key={report.id}
              className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-brand-50/30"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <PlatformIcon name={report.icon} />
              </span>

              <div className="min-w-0 flex-1">
                {/* Name and its metadata share a line, the metadata trailing
                    right and muted. Given its own line beneath the description
                    it cost a third row per report and made the catalogue taller
                    than the card grid it replaced — the supporting fact was
                    quiet but no longer cheap. It wraps under the name only when
                    the row is too narrow to hold both. */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  {report.built ? (
                    <Link
                      href={href}
                      className="text-base font-semibold text-ink hover:text-brand-700 hover:underline"
                    >
                      {report.title}
                    </Link>
                  ) : (
                    <span className="text-base font-semibold text-ink">
                      {report.title}
                    </span>
                  )}
                  <span className="text-xs text-ink-subtle">
                    {scopeLabel(report, viewer)}
                    <span aria-hidden="true"> · </span>
                    {dataLabel(report, viewer)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-ink-subtle">
                  {report.description}
                </p>
              </div>

              <div className="shrink-0 self-center">
                {report.built ? (
                  <Link
                    href={href}
                    className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-sunken"
                  >
                    Open
                  </Link>
                ) : (
                  <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                    Coming soon
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </TableSurface>
  );
}

/* -------------------------------------------------------------------------- */
/* Legacy card grid — REPORTS_LAYOUT=cards                                    */
/* -------------------------------------------------------------------------- */

/**
 * The previous layout, kept verbatim so the comparison is like-for-like and a
 * revert is a configuration change rather than a code change.
 */
function LegacyCardGrid({ reports }: { reports: ReportType[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {reports.map((report) => (
        <ReportCard key={report.id} report={report} />
      ))}
    </div>
  );
}

function ReportCard({ report }: { report: ReportType }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <PlatformIcon name={report.icon} />
        </span>
        {!report.built && (
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Coming soon
          </span>
        )}
      </div>
      <p className="mt-3 text-base font-semibold text-ink">{report.title}</p>
      <p className="mt-0.5 flex-1 text-sm text-ink-subtle">
        {report.description}
      </p>
      {report.built && (
        <span className="mt-3 text-sm font-semibold text-brand-700">
          Open report →
        </span>
      )}
    </>
  );

  if (report.built) {
    return (
      <Link
        href={`/platform/dashboard/reports/${report.id}`}
        className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/40"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card">
      {inner}
    </div>
  );
}
