import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { CheckOutButton } from '@/components/checkin/CheckOutButton';
import { BulletinBoard } from '@/components/checkin/BulletinBoard';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import {
  getSubmissionForWorker,
  checkInReference,
} from '@/services/submissions/submissionService';
import { listActiveBulletinsForWorker } from '@/services/bulletins/bulletinService';
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

  // Daily Bulletins (SC-002): active bulletins for this site the worker hasn't
  // yet read. Shown as dismissible cards below the success heading.
  const newBulletins = (
    await listActiveBulletinsForWorker(submission.jobSiteId, worker.id)
  )
    .filter((b) => !b.acknowledged)
    .map((b) => ({
      id: b.id,
      category: b.category,
      title: b.title,
      body: b.body,
      publishedAtLabel: formatDateTimeUK(b.publishedAt),
    }));

  return (
    <AppShell>
      <section className="flex flex-col items-center gap-3 py-6 text-center">
        <span
          className="flex h-16 w-16 animate-pop-in items-center justify-center rounded-full bg-safe-600 text-white"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <h1 className="text-2xl font-bold text-ink">
          {checkedOut ? 'Checked out successfully' : 'Checked in successfully'}
        </h1>
        <p className="text-ink-muted">
          at{' '}
          <span className="font-semibold text-ink">
            {submission.jobSite.name}
          </span>
        </p>
      </section>

      {newBulletins.length > 0 && (
        <div className="mb-5">
          <BulletinBoard bulletins={newBulletins} />
        </div>
      )}

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Check-in summary
        </h2>
        <dl className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <Row label="Site" value={submission.jobSite.name} />
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
      </section>

      <div className="mt-6 space-y-3">
        {checkedOut ? (
          <>
            <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-center text-sm text-ink-muted">
              You’ve checked out. Stay safe.
            </p>
            <Link href="/" className="block">
              <Button size="lg" fullWidth>
                Finish
              </Button>
            </Link>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-safe-500/40 bg-safe-50 px-4 py-3 text-center text-sm text-safe-700">
              <p className="font-semibold">
                Remember to check out before you leave site.
              </p>
              <p className="mt-0.5 text-safe-700/80">
                Keep this screen as proof of your induction.
              </p>
            </div>
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
