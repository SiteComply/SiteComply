import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/cn';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { RowLink, DrillChevron } from '@/components/platform/RowLink';
import { RecordHeader } from '@/components/platform/RecordHeader';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getWorkerDetailForViewer } from '@/services/workers/workerDetailService';
import { CSCS_CARD_LABELS, cscsVerificationLabel } from '@/lib/cscs';
import { schemeById } from '@/services/cscs/schemes';
import { ManualCheckOutNote } from '@/components/platform/ManualCheckOutNote';
import { CscsCheckNowButton } from '@/components/platform/CscsCheckNowButton';

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
  const { worker, complianceStatus, currentSite, totalCheckIns, history } =
    detail;

  return (
    <PlatformShell>
      <RecordHeader
        breadcrumbs={[
          { label: 'Check-ins', href: '/platform/dashboard/submissions' },
          { label: worker.fullName },
        ]}
        backHref="/platform/dashboard/submissions"
        backLabel="Check-ins"
        title={worker.fullName}
        badges={
          currentSite ? (
            <StatusPill label="On site" tone="good" />
          ) : (
            <StatusPill label="Not on site" tone="muted" />
          )
        }
        subtitle={worker.company}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Compliance status">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Latest check-in"
                value={
                  complianceStatus.latestStatus === 'COMPLIANT'
                    ? 'Compliant'
                    : 'Incomplete'
                }
              />
              <Stat
                label="Check-ins (your sites)"
                value={String(totalCheckIns)}
              />
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
              Compliance reflects the operative&rsquo;s most recent check-in on
              your sites.
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
                          <td className="py-2.5 pr-3 tabular-nums text-ink-muted">
                            {h.checkedOutAt ? (
                              <>
                                {formatDateTimeUK(h.checkedOutAt)}
                                <ManualCheckOutNote row={h} />
                              </>
                            ) : (
                              <span className="font-semibold text-safe-700">
                                On site
                              </span>
                            )}
                          </td>
                          <td className="py-2.5">
                            <StatusPill
                              label={
                                h.status === 'COMPLIANT'
                                  ? 'Compliant'
                                  : 'Incomplete'
                              }
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
          <Section title="Operative information">
            <dl className="space-y-3">
              <Detail label="Company" value={worker.company} />
              {canSeeMobile && <Detail label="Mobile" value={worker.mobile} />}
              <Detail
                label="CSCS card"
                value={
                  worker.cscsCardType
                    ? CSCS_CARD_LABELS[worker.cscsCardType]
                    : 'None recorded'
                }
              />
              {worker.cscsCardNumber && (
                <Detail label="CSCS number" value={worker.cscsCardNumber} />
              )}
              {/* Validate against a real card without switching the live
                provider for every operative. Placed with the CSCS details
                it acts on, not in a toolbar away from them. */}
              {/* Only where the server will honour it: the route asks for the
                same 'export' permission, so the button is never offered to a
                role it would refuse. */}
              {!worker.cscsExempt && worker.cscsCardNumber && canSeeMobile && (
                <CscsCheckNowButton workerId={worker.id} />
              )}
              {/* The exempt test account, said plainly.
                An account that never verifies looks like a fault unless the
                screen says otherwise, and the person most likely to hit it is
                whoever is troubleshooting something else at the time. */}
              {worker.cscsExempt && (
                <div className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
                  <span className="font-semibold text-ink">
                    Exempt from CSCS Smart Check.
                  </span>{' '}
                  This is a designated test account. Its card details are not
                  sent to CSCS, so it stays unverified by design. The exemption
                  is set in configuration and can be removed without a release.
                </div>
              )}
              {/* What a Smart Check needs, and whether we have it.
                    Shown only for a worker who HAS a card, because that is the
                    only case where the absence matters. States the consequence
                    rather than leaving an admin to work out why a card that
                    looks fine is never verified. */}
              {worker.cscsCardNumber && (
                <>
                  <Detail
                    label="Surname"
                    value={worker.surname ?? 'Not provided'}
                  />
                  <Detail
                    label="Card scheme"
                    value={
                      schemeById(worker.cscsSchemeId)?.name ??
                      worker.cscsSchemeId ??
                      'Not provided'
                    }
                  />
                  {(!worker.surname || !worker.cscsSchemeId) && (
                    <div className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
                      CSCS Smart Check needs the scheme, surname and card number
                      together. This card cannot be checked until the operative
                      supplies the missing details — they are asked on their
                      next check-in.
                    </div>
                  )}
                </>
              )}
              {worker.cscsExpiry && (
                <Detail
                  label="CSCS expiry"
                  value={`${formatDateUK(worker.cscsExpiry)}${
                    complianceStatus.cscsValid === false ? ' (expired)' : ''
                  }`}
                />
              )}
              {worker.cscsVerificationStatus && (
                <div>
                  {/* CSCS cutover Phase 1 — this said "Smart Check" over
                      whatever the mock invented. Name the provider that
                      actually produced the result. */}
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    {worker.verifiedByProvider === 'mock'
                      ? 'Card check (test provider)'
                      : 'Smart Check'}
                  </dt>
                  <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink">
                    <StatusPill
                      label={cscsVerificationLabel(
                        worker.cscsVerificationStatus,
                      )}
                      tone={worker.cscsVerified ? 'good' : 'warn'}
                    />
                    {worker.cscsScheme && (
                      <span className="text-ink-muted">
                        {worker.cscsScheme}
                      </span>
                    )}
                    {worker.verifiedByProvider === 'mock' && (
                      <span className="text-hivis-700 text-xs font-medium">
                        Not a CSCS verification
                      </span>
                    )}
                    {worker.cscsVerifiedAt && (
                      <span className="text-xs text-ink-subtle">
                        {formatDateUK(worker.cscsVerifiedAt)}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {worker.cscsHolderName && (
                <Detail label="Name on card" value={worker.cscsHolderName} />
              )}
              <Detail
                label="First seen"
                value={formatDateUK(worker.createdAt)}
              />
            </dl>
            {worker.cscsQualifications.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Verified competencies
                </p>
                <ul className="mt-1.5 space-y-1 text-sm text-ink">
                  {worker.cscsQualifications.map((q, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span aria-hidden="true" className="text-safe-600">
                        ✓
                      </span>
                      <span>
                        {q.title}
                        {q.detail ? (
                          <span className="text-ink-muted"> — {q.detail}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section title="Current site">
            {currentSite ? (
              <RowLink href={`/platform/dashboard/sites/${currentSite.siteId}`}>
                <span className="block truncate font-semibold text-brand-700">
                  {currentSite.siteName}
                </span>
                <span className="block text-xs text-ink-subtle">
                  Checked in {formatDateTimeUK(currentSite.checkedInAt)}
                </span>
              </RowLink>
            ) : (
              <Empty>Not currently checked in on any of your sites.</Empty>
            )}
          </Section>
        </div>
      </div>
    </PlatformShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
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
        'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        tone === 'good' && 'bg-safe-50 text-safe-700',
        tone === 'warn' && 'bg-hivis-400/25 text-ink',
        tone === 'muted' &&
          'border border-line bg-surface-sunken text-ink-muted',
      )}
    >
      {label}
    </span>
  );
}
