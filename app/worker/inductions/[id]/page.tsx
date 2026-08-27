import { notFound } from 'next/navigation';
import Link from 'next/link';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerIcon } from '@/components/worker/icons';
import { AttendanceShell } from '@/components/attendance/AttendanceShell';
import { PrintButton } from '@/components/worker/PrintButton';
import {
  requireWorkerIdentity,
  getWorkerContext,
} from '@/services/workerDashboard/workerDashboardService';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { getWorkerInductionRecord } from '@/services/inductionSignature/inductionRecordService';
import { checkInReference } from '@/services/submissions/submissionService';
import { formatDateUK, formatTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Worker → Induction record (SC-011). The formal, signed induction record —
 * doubles as the completion screen straight after signing (?completed=1) and as
 * the view-any-time record from Inductions history. Includes the declaration,
 * the signature and a print-to-PDF option.
 */
export default async function WorkerInductionRecordPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { completed?: string };
}) {
  const worker = await requireWorkerIdentity();
  const context = await getWorkerContext();

  const record = await getWorkerInductionRecord(worker.id, params.id);
  if (!record) notFound();
  const unread = context
    ? await countUnreadBulletinsForWorker(context.site.id, worker.id)
    : 0;

  const justCompleted = searchParams.completed === '1';
  const reference = checkInReference(record.submissionId);

  return (
    <AttendanceShell context={context} unreadBulletins={unread}>
      {!justCompleted && (
        <div className="mb-3 print:hidden">
          <Link
            href="/worker/inductions"
            className="text-sm font-semibold text-brand-700 hover:underline"
          >
            ← Inductions
          </Link>
        </div>
      )}

      {/* Completion / header */}
      {justCompleted ? (
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-safe-600 text-white">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-9 w-9"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <h1 className="text-2xl font-bold text-ink">Induction completed</h1>
          <p className="max-w-sm text-ink-muted">
            Thank you. Your induction has been successfully completed and
            signed.
          </p>
        </div>
      ) : (
        <WorkerPageHeader
          title="Induction record"
          description={record.siteName}
        />
      )}

      {/* Induction record */}
      <section className="mb-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line bg-surface-sunken px-4 py-2.5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-subtle">
            Induction record
          </h2>
        </div>
        <dl>
          <Row label="Site" value={record.siteName} />
          {record.siteAddress && (
            <Row label="Address" value={record.siteAddress} />
          )}
          <Row
            label="Induction version"
            value={String(record.checklistVersion)}
          />
          <Row label="Completed by" value={record.workerName} />
          <Row label="Date" value={formatDateUK(record.completedAt)} />
          <Row label="Time" value={formatTimeUK(record.completedAt)} />
          {/* The outcome, not attempt-level performance. The check cannot
              complete until every question is answered correctly, so a completed
              attempt is a pass at the full question count. */}
          <Row
            label="Knowledge check"
            value={
              record.knowledgeCheck?.passed
                ? `Passed (${record.knowledgeCheck.total}/${record.knowledgeCheck.total})`
                : record.knowledgeCheckPassed
                  ? 'Passed'
                  : record.knowledgeCheckSkipped
                    ? 'Not required'
                    : '—'
            }
            good={record.knowledgeCheckPassed}
          />
          <Row label="Check-in reference" value={reference} mono />
        </dl>
      </section>

      {/* Signature */}
      {record.signed && (
        <section className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-subtle">
            Your digital signature
          </h2>
          <div className="flex min-h-[6rem] items-center justify-center rounded-lg border border-line bg-surface-sunken p-3">
            {record.signatureType === 'DRAWN' && record.hasSignatureImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/worker/inductions/${record.submissionId}/signature`}
                alt={`Signature of ${record.signedName ?? record.workerName}`}
                className="max-h-32 w-auto"
              />
            ) : (
              <span
                className="text-3xl text-ink"
                style={{
                  fontFamily: '"Segoe Script", "Brush Script MT", cursive',
                }}
              >
                {record.signedName ?? record.workerName}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            Signed by {record.signedName ?? record.workerName}
            {record.signedAt
              ? ` · ${formatDateUK(record.signedAt)} ${formatTimeUK(record.signedAt)}`
              : ''}
          </p>
          {record.declarationText && (
            <p className="mt-3 border-t border-line pt-3 text-xs italic text-ink-muted">
              “{record.declarationText}”
            </p>
          )}
        </section>
      )}

      <div className="space-y-3">
        <PrintButton label="View / download record" />
        {justCompleted && (
          <Link
            href="/worker/dashboard"
            className="flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white print:hidden"
          >
            Return to dashboard
          </Link>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-ink-subtle print:hidden">
        <WorkerIcon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        You can view or download this induction record at any time from your
        Inductions history.
      </p>
    </AttendanceShell>
  );
}

function Row({
  label,
  value,
  good,
  mono,
}: {
  label: string;
  value: string;
  good?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd
        className={`text-right text-sm font-semibold ${good ? 'text-safe-700' : 'text-ink'} ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
