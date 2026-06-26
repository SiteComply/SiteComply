import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSubmissionDetail } from '@/services/submissions/submissionQueryService';
import { checkInReference } from '@/services/submissions/submissionService';
import { ErasePersonalData } from '@/components/admin/ErasePersonalData';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';
import { CSCS_CARD_LABELS } from '@/lib/cscs';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

type AnswerValue = boolean | 'yes' | 'no' | undefined;

function answerText(
  type: string,
  value: AnswerValue,
): {
  text: string;
  ok: boolean;
} {
  if (type === 'YES_NO') {
    return {
      text: value === 'yes' ? 'Yes' : value === 'no' ? 'No' : '—',
      ok: value === 'yes',
    };
  }
  if (type === 'PPE_CONFIRM') {
    return value === true
      ? { text: 'Confirmed', ok: true }
      : { text: 'Not confirmed', ok: false };
  }
  // ACKNOWLEDGEMENT
  return value === true
    ? { text: 'Acknowledged', ok: true }
    : { text: 'Not acknowledged', ok: false };
}

/** Full detail of a single submission: every answered item + acknowledgements. */
export default async function SubmissionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const detail = await getSubmissionDetail(params.id);
  if (!detail) notFound();

  const { submission, items } = detail;
  const answers = (submission.answers ?? {}) as Record<string, AnswerValue>;
  const worker = submission.worker;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/submissions"
          className="text-sm font-semibold text-brand-700"
        >
          ← Back to submissions
        </Link>
        <h1 className="text-2xl font-bold text-ink">{worker.fullName}</h1>
        <p className="text-ink-muted">{worker.company}</p>
      </header>

      <dl className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <Row
          label="Site"
          value={`${submission.jobSite.name} · ${submission.jobSite.jobReference}`}
        />
        <Row label="Mobile" value={worker.mobile} />
        {worker.cscsCardType && (
          <Row
            label="CSCS card"
            value={`${CSCS_CARD_LABELS[worker.cscsCardType]}${
              worker.cscsCardNumber ? ` · ${worker.cscsCardNumber}` : ''
            }${worker.cscsExpiry ? ` · exp ${formatDateUK(worker.cscsExpiry)}` : ''}`}
          />
        )}
        <Row
          label="Checked in"
          value={formatDateTimeUK(submission.checkedInAt)}
        />
        <Row
          label="Checked out"
          value={
            submission.checkedOutAt
              ? formatDateTimeUK(submission.checkedOutAt)
              : 'Still on site'
          }
        />
        <Row
          label="Checklist version"
          value={String(submission.checklistVersion)}
        />
        <Row
          label="Compliance"
          value={submission.status === 'COMPLIANT' ? 'Compliant' : 'Incomplete'}
        />
        <Row
          label="Check-in reference"
          value={checkInReference(submission.id)}
          mono
        />
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Acknowledgements</h2>
        <div className="grid grid-cols-2 gap-2">
          <Gate label="PPE confirmed" ok={submission.ppeConfirmed} />
          <Gate
            label="Site rules acknowledged"
            ok={submission.rulesAcknowledged}
          />
          <Gate label="Safe working agreed" ok={submission.safeWorkingAgreed} />
          <Gate label="UK GDPR consent" ok={submission.gdprConsent} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">
          Checklist responses ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-4 py-4 text-sm text-ink-subtle">
            The checklist for this version is no longer available.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {items.map((item) => {
              const a = answerText(item.type, answers[item.id]);
              return (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0 text-sm text-ink">{item.label}</span>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-semibold',
                      a.ok ? 'text-safe-700' : 'text-danger-600',
                    )}
                  >
                    {a.text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Data protection</h2>
        <p className="text-sm text-ink-subtle">
          Erase this worker’s personal data to honour a UK GDPR erasure request.
          Their identifiers are anonymised; the anonymised compliance record is
          kept.
        </p>
        <ErasePersonalData
          workerId={submission.workerId}
          erased={worker.mobile.startsWith('erased:')}
        />
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          'text-right text-sm font-semibold text-ink',
          mono && 'font-mono tracking-wide',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Gate({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        ok
          ? 'border-safe-500/40 bg-safe-50 text-safe-700'
          : 'border-danger-500/40 bg-danger-50 text-danger-700',
      )}
    >
      <span aria-hidden="true">{ok ? '✓' : '✗'}</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}
