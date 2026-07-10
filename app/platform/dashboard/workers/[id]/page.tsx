import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/cn';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { RowLink, DrillChevron } from '@/components/platform/RowLink';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits, canManualCheckOut } from '@/services/platformUsers/platformPermissions';
import { getWorkerDetailForViewer } from '@/services/workers/workerDetailService';
import { ManualCheckOutButton } from '@/components/platform/ManualCheckOutButton';
import { CSCS_CARD_LABELS } from '@/lib/cscs';

export const dynamic = 'force-dynamic';

/**
 * Platform → Worker Details (drill-down from a submission). Aggregates the
 * worker's identity, compliance status, current site and check-in / submission
 * history — but ONLY across the viewer's Assigned Sites (enforced in the service,
 * which 404s a worker with no in-scope activity). The worker's mobile number is
 * shown only to roles trusted to export worker data.
 */
export default async function WorkerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'checkins');

  const detail = await getWorkerDetailForViewer(viewer, params.id);
  if (!detail) notFound();

  const canSeeMobile = permits(viewer.role, 'checkins', 'export');
  const canCheckOut = canManualCheckOut(viewer.role);
  const { worker, complianceStatus, currentSite, totalCheckIns, history } = detail;

  return (
    <PlatformShell>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: 'Check-ins', href: '/platform/dashboard/submissions' },
            { label: worker.fullName },
          ]}
        />
        <Link
          href="/platform/dashboard/submissions"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Check-ins
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-ink">{worker.fullName}</h1>
              {currentSite ? (
                <StatusPill label="On site" tone="good" />
              ) : (
                <StatusPill label="Not on site" tone="muted" />
              )}
            </div>
            <p className="text-ink-muted">{worker.company}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Compliance status">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Latest check-in"
                value={complianceStatus.latestStatus === 'COMPLIANT' ? 'Compliant' : 'Incomplete'}
              />
              <Stat label="Check-ins (your sites)" value={String(totalCheckIns)} />
              <Stat
                label="CSCS card"
                value={
                  complianceStatus.cscsValid === null
                    ? 'None'
                    : complianceStatus.cscsValid
                      ? 'Valid'
                      : 'Expired'
                }
              />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Gate label="PPE" ok={complianceStatus.ppe} />
              <Gate label="Site rules" ok={complianceStatus.rules} />
              <Gate label="Safe working" ok={complianceStatus.safe} />
              <Gate label="GDPR consent" ok={complianceStatus.gdpr} />
            </dl>
            <p className="mt-3 text-xs text-ink-subtle">
              Compliance reflects the worker&rsquo;s most recent check-in on your sites.
            </p>
          </Section>

          <Section title="Check-in history">
            {history.length === 0 ? (
              <Empty>No check-ins on your sites.</Empty>
            ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
                      <th className="py-2 pr-3 font-medium">Site</th>
                      <th className="py-2 pr-3 font-medium">Checked in</th>
                      <th className="py-2 pr-3 font-medium">Checked out</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="w-6 py-2" aria-hidden="true"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {history.map((h) => (
                      <tr
                        key={h.id}
                        className="group relative cursor-pointer transition-colors hover:bg-brand-50/60"
                      >
                        <td className="py-2.5 pr-3">
                          {/* Stretched link — makes the whole row a drill-down to the site. */}
                          <Link
                            href={`/platform/dashboard/sites/${h.siteId}`}
                            className="font-medium text-brand-700 after:absolute after:inset-0 group-hover:underline"
                          >
                            {h.siteName}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-ink-muted">
                          {formatDateTimeUK(h.checkedInAt)}
                        </td>
                        <td className="py-2.5 pr-3 text-ink-muted">
                          {h.checkedOutAt ? (
                            <>
                              <span className="tabular-nums">{formatDateTimeUK(h.checkedOutAt)}</span>
                              {h.checkedOutManual && (
                                <span className="mt-0.5 block text-xs text-ink-subtle">
                                  Manual · {h.checkedOutByName ?? 'Unknown'}
                                  {h.checkedOutReason ? ` — ${h.checkedOutReason}` : ''}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="font-semibold text-safe-700">On site</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <StatusPill
                            label={h.status === 'COMPLIANT' ? 'Compliant' : 'Incomplete'}
                            tone={h.status === 'COMPLIANT' ? 'good' : 'warn'}
                          />
                        </td>
                        <td className="py-2.5 pl-2 text-right align-middle">
                          <DrillChevron />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                Select a row to open that site&rsquo;s details.
              </p>
              </>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Worker information">
            <dl className="space-y-3">
              <Detail label="Company" value={worker.company} />
              {canSeeMobile && <Detail label="Mobile" value={worker.mobile} />}
              <Detail
                label="CSCS card"
                value={worker.cscsCardType ? CSCS_CARD_LABELS[worker.cscsCardType] : 'None recorded'}
              />
              {worker.cscsCardNumber && (
                <Detail label="CSCS number" value={worker.cscsCardNumber} />
              )}
              {worker.cscsExpiry && (
                <Detail
                  label="CSCS expiry"
                  value={`${formatDateUK(worker.cscsExpiry)}${
                    complianceStatus.cscsValid === false ? ' (expired)' : ''
                  }`}
                />
              )}
              <Detail label="First seen" value={formatDateUK(worker.createdAt)} />
            </dl>
          </Section>

          <Section title="Current site">
            {currentSite ? (
              <div className="space-y-3">
                <RowLink href={`/platform/dashboard/sites/${currentSite.siteId}`}>
                  <span className="block truncate font-semibold text-brand-700">
                    {currentSite.siteName}
                  </span>
                  <span className="block text-xs text-ink-subtle">
                    Checked in {formatDateTimeUK(currentSite.checkedInAt)}
                  </span>
                </RowLink>
                {canCheckOut && (
                  <ManualCheckOutButton
                    submissionId={currentSite.submissionId}
                    workerName={worker.fullName}
                    siteName={currentSite.siteName}
                  />
                )}
              </div>
            ) : (
              <Empty>Not currently checked in on any of your sites.</Empty>
            )}
          </Section>
        </div>
      </div>
    </PlatformShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <div className="text-lg font-bold text-ink">{value}</div>
      <div className="text-xs text-ink-subtle">{label}</div>
    </div>
  );
}

function Gate({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white',
          ok ? 'bg-safe-500' : 'bg-danger-500',
        )}
      >
        {ok ? '✓' : '✕'}
      </span>
      <span className="text-sm text-ink">{label}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>;
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'good' | 'warn' | 'muted';
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
        tone === 'good' && 'bg-safe-50 text-safe-700',
        tone === 'warn' && 'bg-hivis-400/25 text-ink',
        tone === 'muted' && 'border border-line bg-surface-sunken text-ink-muted',
      )}
    >
      {label}
    </span>
  );
}
