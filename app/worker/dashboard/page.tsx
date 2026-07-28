import { WorkerShell } from '@/components/worker/WorkerShell';
import { BulletinBoard } from '@/components/checkin/BulletinBoard';
import { CheckOutOfSiteButton } from '@/components/worker/CheckOutOfSiteButton';
import {
  PanelCard,
  PanelEmpty,
  PanelLine,
  PanelMetric,
} from '@/components/worker/PanelCard';
import { WorkerIcon } from '@/components/worker/icons';
import Link from 'next/link';
import { formatDateTimeUK, formatHoursMinutes } from '@/lib/datetime';
import { checkInReference } from '@/services/submissions/submissionService';
import {
  requireWorkerContext,
  getWorkerDashboardCounts,
  getWorkerBulletins,
  getWorkerSiteContacts,
} from '@/services/workerDashboard/workerDashboardService';
import {
  listWorkerAttendance,
  summarise,
  currentWeekRange,
} from '@/services/attendance/attendanceHistoryService';

export const dynamic = 'force-dynamic';

/**
 * The Worker Dashboard (SC-003) — the landing page after a successful site
 * check-in and the worker's home while they are on site.
 *
 * Which cards appear is decided per site by `context.panels` (see
 * services/workerDashboard/dashboardPanels): site managers switch panels on and
 * off, and anything switched off is absent here AND from the sidebar, with no
 * empty placeholder left behind. Everything shown is scoped to the one site the
 * worker is actually checked into.
 */
export default async function WorkerDashboardPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();

  const counts = await getWorkerDashboardCounts(site.id, worker.id);

  // SC-010: this week's attendance at a glance (across all the worker's sites).
  const weekAttendance = summarise(
    await listWorkerAttendance(worker.id, currentWeekRange()),
  );

  // Unacknowledged bulletins lead the page as dismissible cards, exactly as they
  // do on the check-in confirmation (SC-002).
  const newBulletins = panels.DAILY_BULLETIN
    ? (await getWorkerBulletins(site.id, worker.id))
        .filter((b) => !b.acknowledged)
        .map((b) => ({
          id: b.id,
          category: b.category,
          title: b.title,
          body: b.body,
          publishedAtLabel: formatDateTimeUK(b.publishedAt),
        }))
    : [];

  // The card previews the first couple of contacts; the rest are one tap away.
  const contacts = panels.SITE_CONTACTS
    ? (await getWorkerSiteContacts(site.id)).slice(0, 2)
    : [];

  const firstName = worker.fullName.trim().split(/\s+/)[0] || worker.fullName;
  const hasEmergencyDetail = Boolean(
    site.nearestHospital ||
      site.emergencyNumber ||
      (panels.FIRE_ASSEMBLY_POINT && site.fireAssemblyPoint),
  );

  return (
    <WorkerShell
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      sites={openCheckIns}
      activeSiteId={activeSiteId}
      unreadBulletins={counts.unreadBulletins}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            Welcome back, {firstName} <span aria-hidden="true">👋</span>
          </h1>
          <p className="text-ink-muted">
            Here’s what you need to know while you’re on site.
          </p>
        </div>
        {panels.CHECK_OUT && (
          <CheckOutOfSiteButton submissionId={submission.id} />
        )}
      </header>

      {newBulletins.length > 0 && (
        <div className="mb-5">
          <BulletinBoard bulletins={newBulletins} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {panels.SITE_INFORMATION && (
          <PanelCard
            icon="building"
            tone="brand"
            title="Site Information"
            href="/worker/site-information"
            linkLabel="View site information"
          >
            <p className="font-semibold text-ink">{site.name}</p>
            <p>Site reference: {site.jobReference}</p>
          </PanelCard>
        )}

        {panels.ACTIVE_PERMITS && (
          <PanelCard
            icon="permit"
            tone="safe"
            title="Active Permits"
            href="/worker/permits"
            linkLabel="View permits"
          >
            <PanelMetric
              value={counts.activePermits}
              label="Your active permits"
              tone="safe"
            />
          </PanelCard>
        )}

        {panels.RAMS && (
          <PanelCard
            icon="rams"
            tone="teal"
            title="RAMS"
            href="/worker/rams"
            linkLabel="View RAMS"
          >
            <PanelMetric
              value={counts.ramsDocuments}
              label="Active RAMS"
              tone="teal"
            />
          </PanelCard>
        )}

        {panels.SITE_DOCUMENTS && (
          <PanelCard
            icon="doc"
            tone="brand"
            title="Site Documents"
            href="/worker/documents"
            linkLabel="View documents"
          >
            <PanelMetric
              value={counts.otherDocuments}
              label={counts.otherDocuments === 1 ? 'Document' : 'Documents'}
              tone="brand"
            />
          </PanelCard>
        )}

        {panels.EMERGENCY_INFORMATION && (
          <PanelCard
            icon="alert"
            tone="danger"
            title="Emergency Information"
            href="/worker/emergency"
            linkLabel="View full emergency info"
          >
            {hasEmergencyDetail ? (
              <div className="space-y-2.5">
                {site.nearestHospital && (
                  <PanelLine
                    icon="firstaid"
                    tone="danger"
                    label="Nearest A&E"
                    value={site.nearestHospital}
                  />
                )}
                <PanelLine
                  icon="phone"
                  tone="danger"
                  label="Emergency number"
                  value={site.emergencyNumber || '999'}
                />
                {panels.FIRE_ASSEMBLY_POINT && site.fireAssemblyPoint && (
                  <PanelLine
                    icon="fire"
                    tone="hivis"
                    label="Fire assembly point"
                    value={site.fireAssemblyPoint}
                  />
                )}
              </div>
            ) : (
              <PanelEmpty>
                In an emergency call 999. Site-specific details haven’t been
                added yet.
              </PanelEmpty>
            )}
          </PanelCard>
        )}

        {panels.FIRST_AIDER && (
          <PanelCard
            icon="firstaid"
            tone="safe"
            title="First Aider"
            href="/worker/emergency"
            linkLabel="View emergency info"
          >
            {site.firstAiderName ? (
              <div className="space-y-2.5">
                <PanelLine
                  icon="user"
                  tone="safe"
                  label={site.firstAiderName}
                  value={site.firstAiderNumber || 'First aider'}
                />
                {site.firstAiderLocation && (
                  <PanelLine
                    icon="building"
                    tone="safe"
                    label="Location"
                    value={site.firstAiderLocation}
                  />
                )}
              </div>
            ) : (
              <PanelEmpty>
                No first aider has been recorded for this site.
              </PanelEmpty>
            )}
          </PanelCard>
        )}

        {panels.SITE_CONTACTS && (
          <PanelCard
            icon="phone"
            tone="brand"
            title="Site Contacts"
            href="/worker/contacts"
            linkLabel="View all contacts"
          >
            {contacts.length === 0 ? (
              <PanelEmpty>
                No contacts have been added for this site.
              </PanelEmpty>
            ) : (
              <div className="space-y-2.5">
                {contacts.map((c) => (
                  <div key={c.id}>
                    <p className="text-sm font-semibold text-ink">{c.role}</p>
                    {c.name && <p className="text-sm text-ink">{c.name}</p>}
                    {c.phone && (
                      <a
                        href={`tel:${c.phone.replace(/\s+/g, '')}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
                      >
                        {c.phone}
                        <WorkerIcon name="phone" className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </PanelCard>
        )}

        {panels.OUTSTANDING_ACTIONS && (
          <PanelCard
            icon="clipboard"
            tone="hivis"
            title="Outstanding Actions"
            href="/worker/actions"
            linkLabel="View actions"
          >
            <PanelMetric
              value={counts.outstandingActions}
              label={
                counts.outstandingActions === 1
                  ? 'Action to complete'
                  : 'Actions to complete'
              }
              tone="hivis"
            />
          </PanelCard>
        )}

        {panels.MESSAGES && (
          <PanelCard
            icon="message"
            tone="brand"
            title="Messages"
            href="/worker/messages"
            linkLabel="View messages"
          >
            <PanelEmpty>
              Worker messaging isn’t available yet. Site notices are published
              as Daily Bulletins.
            </PanelEmpty>
          </PanelCard>
        )}
      </div>

      <section className="mt-5 rounded-xl border border-brand-200 bg-brand-50 p-4">
        <h2 className="flex items-center gap-2.5 text-sm font-bold text-brand-700">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-brand-500 text-brand-700"
          >
            <WorkerIcon name="user" className="h-5 w-5" />
          </span>
          Your Check-in Summary
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <SummaryRow
            label="Checked in"
            value={formatDateTimeUK(submission.checkedInAt)}
          />
          <SummaryRow label="Company" value={worker.company} />
          <SummaryRow
            label="Check-in reference"
            value={checkInReference(submission.id)}
            mono
          />
          <SummaryRow label="Your name" value={worker.fullName} />
        </dl>
      </section>

      {/* SC-010: this-week attendance summary → full attendance history. */}
      <Link
        href="/worker/attendance"
        className="mt-4 flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-card hover:bg-surface-sunken"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <WorkerIcon name="clock" className="h-6 w-6" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-bold text-ink">My attendance</p>
          <p className="text-sm text-ink-muted">
            This week: {formatHoursMinutes(weekAttendance.totalMinutes)} ·{' '}
            {weekAttendance.daysOnSite} day
            {weekAttendance.daysOnSite === 1 ? '' : 's'}
            {weekAttendance.incompleteCount > 0 && (
              <span className="font-semibold text-hivis-600">
                {' '}
                · {weekAttendance.incompleteCount} missing check-out
                {weekAttendance.incompleteCount === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-ink-subtle">›</span>
      </Link>

      <section className="mt-4 flex items-center gap-3 rounded-xl border border-safe-500/40 bg-safe-50 px-4 py-3">
        <span aria-hidden="true" className="shrink-0 text-safe-600">
          <WorkerIcon name="shield" className="h-7 w-7" />
        </span>
        <div>
          <p className="text-sm font-bold text-safe-700">
            Remember to check out before you leave site.
          </p>
          <p className="text-sm text-safe-700/80">
            Thank you for helping us keep sites safe and compliant.
          </p>
        </div>
      </section>
    </WorkerShell>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200/70 bg-surface px-3 py-2">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd
        className={`text-right text-sm font-semibold text-ink ${mono ? 'font-mono tracking-wide' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
