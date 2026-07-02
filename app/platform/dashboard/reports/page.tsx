import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PlatformIcon } from '@/components/platform/icons';
import {
  requirePlatformViewer,
  describeScope,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { getVisibleReports } from '@/services/reports/reportAccess';
import type { ReportType } from '@/services/reports/reportRegistry';

export const dynamic = 'force-dynamic';

/**
 * Reports landing — catalogue of report types the viewer may run, filtered by
 * role (Organisation Overview is Director-only) and shown with their site-access
 * scope. The individual reports and their CSV exports are built in later phases;
 * for now each entry is a preview of what's coming.
 */
export default async function PlatformReportsPage() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'reports');

  const reports = getVisibleReports(viewer);

  return (
    <PlatformShell>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Reports</h1>
          <p className="text-ink-muted">
            Compliance and attendance reporting across your sites.
          </p>
        </div>
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {describeScope(viewer)}
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </div>
    </PlatformShell>
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
