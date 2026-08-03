import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { RecordHeader } from '@/components/platform/RecordHeader';
import { PermitReviewControls } from '@/components/platform/PermitReviewControls';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { getPermitForViewer } from '@/services/permits/permitAdminService';
import {
  permitStatusLabel,
  PERMIT_STATUS_BADGE,
} from '@/services/permits/permitConstants';
import { formatAnswer } from '@/services/permits/permitFlow';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Permit detail + review (SC-009). Scoped to the viewer's sites. */
export default async function PlatformPermitDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'permits');

  const detail = await getPermitForViewer(viewer, params.id);
  if (!detail) notFound();

  const {
    permit,
    effectiveStatus,
    siteName,
    workerName,
    workerCompany,
    answers,
    activities,
    canApprove,
  } = detail;

  return (
    <PlatformShell>
      <RecordHeader
        breadcrumbs={[
          { label: 'Permits', href: '/platform/dashboard/permits' },
          { label: permit.reference },
        ]}
        backHref="/platform/dashboard/permits"
        backLabel="Permits"
        title={permit.permitTypeName}
        badges={
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${PERMIT_STATUS_BADGE[effectiveStatus]}`}
          >
            {permitStatusLabel(effectiveStatus)}
          </span>
        }
        subtitle={<span className="font-mono">{permit.reference}</span>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
              Request
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Worker"
                value={`${workerName} · ${workerCompany}`}
              />
              <Field label="Site" value={siteName} />
              <Field label="Work activity" value={permit.workActivity} wide />
              <Field label="Work location" value={permit.workLocation ?? '—'} />
              <Field
                label="Proposed start"
                value={
                  permit.proposedStart
                    ? formatDateTimeUK(permit.proposedStart)
                    : '—'
                }
              />
              <Field
                label="Proposed finish"
                value={
                  permit.proposedFinish
                    ? formatDateTimeUK(permit.proposedFinish)
                    : '—'
                }
              />
            </dl>
          </section>

          {answers.length > 0 && (
            <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
                Safety questions
              </h2>
              <dl className="divide-y divide-line">
                {answers.map((a) => (
                  <div
                    key={a.questionId}
                    className="flex justify-between gap-4 py-2.5"
                  >
                    <dt className="text-sm text-ink">{a.label}</dt>
                    <dd className="shrink-0 text-sm font-semibold text-ink">
                      {formatAnswer(a)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <PermitReviewControls
            permitId={permit.id}
            status={effectiveStatus}
            canApprove={canApprove}
          />
        </div>

        <div className="space-y-6">
          {(permit.status === 'APPROVED' || permit.validUntil) && (
            <section className="rounded-xl border border-safe-500/40 bg-safe-50 p-5 shadow-card">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-safe-700">
                Approval
              </h2>
              <dl className="space-y-2">
                <Field
                  label="Approved by"
                  value={permit.approvedByName ?? '—'}
                />
                <Field
                  label="Approved on"
                  value={
                    permit.approvedAt
                      ? formatDateTimeUK(permit.approvedAt)
                      : '—'
                  }
                />
                <Field
                  label="Valid from"
                  value={
                    permit.validFrom ? formatDateTimeUK(permit.validFrom) : '—'
                  }
                />
                <Field
                  label="Valid until"
                  value={
                    permit.validUntil
                      ? formatDateTimeUK(permit.validUntil)
                      : '—'
                  }
                />
              </dl>
            </section>
          )}

          {permit.rejectionReason && (
            <section className="rounded-xl border border-danger-500/40 bg-danger-50 p-5 shadow-card">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-danger-600">
                Rejected
              </h2>
              <p className="text-sm text-ink">{permit.rejectionReason}</p>
              <p className="mt-2 text-xs text-ink-subtle">
                {permit.rejectedByName}
                {permit.rejectedAt
                  ? ` · ${formatDateTimeUK(permit.rejectedAt)}`
                  : ''}
              </p>
            </section>
          )}

          <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
              Activity
            </h2>
            <ol className="space-y-3">
              {activities.map((ev) => (
                <li key={ev.id} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {ev.toValue ?? ev.type}
                    </p>
                    {ev.note && (
                      <p className="text-sm text-ink-muted">{ev.note}</p>
                    )}
                    <p className="text-xs text-ink-subtle">
                      {formatDateTimeUK(ev.createdAt)}
                      {ev.authorName ? ` · ${ev.authorName}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </PlatformShell>
  );
}

function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}
