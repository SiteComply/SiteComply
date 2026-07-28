import { redirect, notFound } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerIcon } from '@/components/worker/icons';
import { PermitActions } from '@/components/permits/PermitActions';
import { cn } from '@/lib/cn';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { requireWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { getWorkerPermit } from '@/services/permits/permitService';
import {
  permitStatusLabel,
  canWorkerCancel,
  PERMIT_STATUS_TONE,
  type PermitStatusValue,
} from '@/services/permits/permitConstants';
import { formatAnswer } from '@/services/permits/permitFlow';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const BANNER: Record<string, string> = {
  brand: 'bg-brand-600 text-white',
  safe: 'bg-safe-600 text-white',
  hivis: 'bg-hivis-500 text-ink',
  danger: 'bg-danger-600 text-white',
  muted: 'bg-ink-subtle text-white',
};

/** Worker → Permit detail (SC-009): status, timeline, details and actions. */
export default async function WorkerPermitDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.ACTIVE_PERMITS) redirect('/worker/dashboard');

  const detail = await getWorkerPermit(worker.id, params.id);
  if (!detail) notFound();

  const unread = await countUnreadBulletinsForWorker(site.id, worker.id);
  const { permit, effectiveStatus, answers } = detail;
  const status = effectiveStatus as PermitStatusValue;
  const tone = PERMIT_STATUS_TONE[status];
  const approved = status === 'APPROVED';

  return (
    <WorkerShell
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      sites={openCheckIns}
      activeSiteId={activeSiteId}
      unreadBulletins={unread}
    >
      <WorkerPageHeader title="Permit" description={site.name} />

      {/* Status banner */}
      <div
        className={cn(
          'mb-4 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide',
          BANNER[tone],
        )}
      >
        {permitStatusLabel(status)}
      </div>

      {/* Header */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <WorkerIcon
            name={permit.permitType.iconKey as never}
            className="h-6 w-6"
          />
        </span>
        <div>
          <p className="text-base font-bold text-ink">
            {permit.permitTypeName}
          </p>
          <p className="font-mono text-xs text-ink-subtle">
            {permit.reference}
          </p>
        </div>
      </div>

      {/* Status timeline */}
      <Timeline status={status} permit={permit} />

      {/* Approved details */}
      {approved && (
        <dl className="mb-4 overflow-hidden rounded-xl border border-safe-500/40 bg-safe-50 shadow-card">
          <Row label="Approved by" value={permit.approvedByName ?? '—'} good />
          <Row
            label="Approved on"
            value={
              permit.approvedAt ? formatDateTimeUK(permit.approvedAt) : '—'
            }
          />
          <Row
            label="Valid from"
            value={permit.validFrom ? formatDateTimeUK(permit.validFrom) : '—'}
          />
          <Row
            label="Valid until"
            value={
              permit.validUntil ? formatDateTimeUK(permit.validUntil) : '—'
            }
          />
        </dl>
      )}

      {/* Rejection */}
      {status === 'REJECTED' && permit.rejectionReason && (
        <div className="mb-4 rounded-xl border border-danger-500/40 bg-danger-50 p-4">
          <p className="text-sm font-semibold text-danger-600">Not approved</p>
          <p className="mt-1 text-sm text-ink">{permit.rejectionReason}</p>
          <p className="mt-1 text-xs text-ink-subtle">
            {permit.rejectedByName}
            {permit.rejectedAt
              ? ` · ${formatDateTimeUK(permit.rejectedAt)}`
              : ''}
          </p>
        </div>
      )}

      {/* Request details */}
      <dl className="mb-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <Row label="Submitted" value={formatDateTimeUK(permit.submittedAt)} />
        <Row label="Submitted by" value={permit.submittedByName} />
        <Row label="Work activity" value={permit.workActivity} />
        {permit.workLocation && (
          <Row label="Work location" value={permit.workLocation} />
        )}
        {permit.proposedStart && (
          <Row
            label="Proposed start"
            value={formatDateTimeUK(permit.proposedStart)}
          />
        )}
        {permit.proposedFinish && (
          <Row
            label="Proposed finish"
            value={formatDateTimeUK(permit.proposedFinish)}
          />
        )}
      </dl>

      {/* Safety answers */}
      {answers.length > 0 && (
        <dl className="mb-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {answers.map((a) => (
            <Row key={a.questionId} label={a.label} value={formatAnswer(a)} />
          ))}
        </dl>
      )}

      {approved && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-safe-500/40 bg-safe-50 p-4">
          <span className="mt-0.5 shrink-0 text-safe-700">
            <WorkerIcon name="shield" className="h-4 w-4" />
          </span>
          <p className="text-sm text-ink">
            This permit must be available on site at all times. Make sure you
            understand all conditions before starting the work.
          </p>
        </div>
      )}

      <PermitActions permitId={permit.id} canCancel={canWorkerCancel(status)} />
    </WorkerShell>
  );
}

function Timeline({
  status,
  permit,
}: {
  status: PermitStatusValue;
  permit: { submittedAt: Date; submittedByName: string };
}) {
  const decided = ['APPROVED', 'REJECTED', 'CLOSED', 'EXPIRED'].includes(
    status,
  );
  const reviewing = status === 'UNDER_REVIEW' || decided;
  const stages = [
    {
      label: 'Submitted',
      done: true,
      meta: `${formatDateTimeUK(permit.submittedAt)} · ${permit.submittedByName}`,
    },
    {
      label: 'Under review',
      done: reviewing,
      meta: reviewing ? '' : 'Pending',
    },
    {
      label: status === 'REJECTED' ? 'Rejected' : 'Approved',
      done: decided,
      meta: decided ? '' : 'Pending',
    },
  ];
  return (
    <ol className="mb-4 space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      {stages.map((s) => (
        <li key={s.label} className="flex gap-3">
          <span
            className={cn(
              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
              s.done
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-line bg-surface',
            )}
          >
            {s.done && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                className="h-3 w-3"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            )}
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                'text-sm font-semibold',
                s.done ? 'text-ink' : 'text-ink-subtle',
              )}
            >
              {s.label}
            </p>
            {s.meta && <p className="text-xs text-ink-subtle">{s.meta}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Row({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          'text-right text-sm font-semibold',
          good ? 'text-safe-700' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
