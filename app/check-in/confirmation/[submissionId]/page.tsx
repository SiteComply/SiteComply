import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { CheckOutButton } from '@/components/checkin/CheckOutButton';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import {
  getSubmissionForWorker,
  checkInReference,
} from '@/services/submissions/submissionService';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Worker check-in confirmation — the reassuring "you're compliant and checked
 * in" screen, with the site, the worker's details, the check-in date/time
 * (DD/MM/YYYY, 24h, Europe/London) and a check-in reference. While on site a
 * check-out affordance is shown; once checked out, the time is displayed.
 */
export default async function ConfirmationPage({
  params,
}: {
  params: { submissionId: string };
}) {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) redirect('/check-in/details');

  const submission = await getSubmissionForWorker(
    params.submissionId,
    worker.id,
  );
  if (!submission) redirect('/check-in');

  const reference = checkInReference(submission.id);
  const checkedOut = Boolean(submission.checkedOutAt);

  return (
    <AppShell>
      <section className="flex flex-col items-center gap-3 py-6 text-center">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full bg-safe-600 text-3xl text-white"
          aria-hidden="true"
        >
          ✓
        </span>
        <h1 className="text-2xl font-bold text-ink">
          You’re compliant and checked in
        </h1>
        <p className="text-ink-muted">
          at{' '}
          <span className="font-semibold text-ink">
            {submission.jobSite.name}
          </span>
        </p>
      </section>

      <dl className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <Row label="Name" value={submission.worker.fullName} />
        <Row label="Company" value={submission.worker.company} />
        <Row
          label="Site reference"
          value={`${submission.jobSite.jobReference}`}
        />
        <Row
          label="Checked in"
          value={formatDateTimeUK(submission.checkedInAt)}
        />
        {checkedOut && submission.checkedOutAt && (
          <Row
            label="Checked out"
            value={formatDateTimeUK(submission.checkedOutAt)}
          />
        )}
        <Row label="Check-in reference" value={reference} mono />
      </dl>

      <div className="mt-6 space-y-3">
        {checkedOut ? (
          <>
            <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-center text-sm text-ink-muted">
              You’ve checked out. Stay safe.
            </p>
            <Link href="/" className="block">
              <Button size="lg" fullWidth>
                Done
              </Button>
            </Link>
          </>
        ) : (
          <>
            <p className="text-center text-sm text-ink-subtle">
              Keep this screen as proof of your induction. Check out when you
              leave site.
            </p>
            <CheckOutButton submissionId={submission.id} />
          </>
        )}
      </div>
    </AppShell>
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
        className={`text-right text-sm font-semibold text-ink ${mono ? 'font-mono tracking-wide' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
