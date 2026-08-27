import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { listSchedules } from '@/services/compliance/scheduleService';
import { ROLE_LABELS } from '@/services/platformUsers/platformUserConstants';
import {
  FREQUENCIES,
  WEEKDAYS,
  activityColour,
} from '@/services/compliance/complianceConstants';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * SC-020 Phase 1 — schedules register.
 *
 * DELIBERATELY A SUPPORTING VIEW. The Compliance Calendar is the primary
 * experience; this exists only as the "View All" destination for people who want
 * to audit the rules themselves rather than see them laid out in time. It stays
 * intentionally plain so it never becomes the place people work.
 */
export default async function ComplianceSchedulesPage({
  searchParams,
}: {
  searchParams: { site?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'audits');
  const schedules = await listSchedules(viewer, searchParams.site);

  const cadence = (s: (typeof schedules)[number]): string => {
    const freq =
      FREQUENCIES.find((f) => f.value === s.frequency)?.label ?? s.frequency;
    if (s.frequency === 'CUSTOM') return `Every ${s.intervalDays ?? 1} days`;
    if (s.frequency === 'MONTHLY') return `Monthly on day ${s.dayOfMonth ?? 1}`;
    if (s.weekdays.length > 0) {
      const days = s.weekdays
        .map((d) => WEEKDAYS.find((w) => w.value === d)?.short ?? d)
        .join(', ');
      return `${freq} · ${days}`;
    }
    return freq;
  };

  return (
    <PlatformShell>
      <div className="mb-4">
        <Breadcrumbs
          items={[
            {
              label: 'Compliance Calendar',
              href: '/platform/dashboard/compliance-calendar',
            },
            { label: 'Schedules' },
          ]}
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">Compliance schedules</h1>
            <p className="text-sm text-ink-muted">
              The recurring rules behind the calendar.
            </p>
          </div>
          <Link
            href="/platform/dashboard/compliance-calendar"
            className="touch-target rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Back to calendar
          </Link>
        </div>
      </div>

      {schedules.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-ink-subtle shadow-card">
          No compliance schedules yet. Create one from the calendar with “+
          Schedule Activity”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-subtle">
                <th className="px-5 py-2.5 font-medium">Activity</th>
                <th className="px-5 py-2.5 font-medium">Site</th>
                <th className="px-5 py-2.5 font-medium">Cadence</th>
                <th className="px-5 py-2.5 font-medium">Time</th>
                <th className="px-5 py-2.5 font-medium">Assigned to</th>
                <th className="px-5 py-2.5 font-medium">From</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {schedules.map((s) => (
                <tr key={s.id} className="hover:bg-brand-50/30">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: activityColour(s.auditTemplateId),
                        }}
                      />
                      <span className="font-semibold text-ink">{s.title}</span>
                    </span>
                    <span className="block text-xs text-ink-subtle">
                      {s.auditTemplate.name} · {s._count.occurrences} generated
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ink">{s.jobSite.name}</td>
                  <td className="px-5 py-3 text-ink-muted">{cadence(s)}</td>
                  <td className="px-5 py-3 tabular-nums text-ink-muted">
                    {s.timeOfDay}
                  </td>
                  <td className="px-5 py-3 text-ink-muted">
                    {s.assigneeKind === 'ROLE'
                      ? (ROLE_LABELS[s.assignedRole ?? 'SITE_MANAGER'] ??
                        s.assignedRole)
                      : 'Named person'}
                  </td>
                  <td className="px-5 py-3 text-ink-muted">
                    {formatDateUK(s.startDate)}
                    {s.endDate ? ` – ${formatDateUK(s.endDate)}` : ''}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                        s.active
                          ? 'bg-safe-50 text-safe-700'
                          : 'bg-surface-sunken text-ink-subtle'
                      }`}
                    >
                      {s.active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PlatformShell>
  );
}
