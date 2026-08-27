import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { WorkerIcon } from '@/components/worker/icons';
import { cn } from '@/lib/cn';
import { formatDateTimeUK } from '@/lib/datetime';
import { checkInReference } from '@/services/submissions/submissionService';
import {
  requireWorkerIdentity,
  getWorkerContext,
  listRecentCheckIns,
} from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/**
 * Worker home (SC-004).
 *
 * The worker's persistent landing while their session is valid. If they have an
 * active check-in it forwards to the dashboard; otherwise — including straight
 * after checking out — it keeps them signed in with continued access rather than
 * dropping them out of the app, offering a one-tap route back onto a site and
 * their recent check-in receipts.
 */
export default async function WorkerHomePage() {
  const worker = await requireWorkerIdentity();

  // Checked into a site → the dashboard is home. (Also how a returning worker is
  // recognised: /worker → /worker/dashboard with no re-authentication.)
  const context = await getWorkerContext();
  if (context) redirect('/worker/dashboard');

  const recent = await listRecentCheckIns(worker.id, 5);
  const firstName = worker.fullName.trim().split(/\s+/)[0] || worker.fullName;

  return (
    <AppShell
      topBarRight={
        <a
          href="/api/worker/logout"
          className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
        >
          Sign out
        </a>
      }
    >
      <section className="mb-6 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-safe-50 text-safe-600"
        >
          <WorkerIcon name="shield" className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-ink">Hi {firstName}</h1>
          <p className="text-ink-muted">
            You’re not checked into a site right now. You’re still signed in —
            check into a site when you arrive.
          </p>
        </div>
      </section>

      <Link href="/check-in/site" className="block">
        <Button size="lg" fullWidth>
          Check into a site
        </Button>
      </Link>

      {/* SC-010: keep attendance discoverable after check-out — a checked-out
          worker has no worker nav, so surface it here (mirrors the dashboard card). */}
      <Link
        href="/worker/attendance"
        className="mt-4 flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <WorkerIcon name="clock" className="h-6 w-6" />
        </span>
        <div className="flex-1">
          <p className="text-base font-semibold text-ink">My attendance</p>
          <p className="text-sm text-ink-muted">
            View your hours and check-in history.
          </p>
        </div>
        <span className="shrink-0 text-ink-subtle">›</span>
      </Link>

      {recent.length > 0 && (
        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Recent check-ins
            </h2>
            <Link
              href="/worker/attendance/history"
              className="text-sm font-semibold text-brand-700 hover:underline"
            >
              View all
            </Link>
          </div>
          <ul className="space-y-3">
            {recent.map((c) => {
              const onSite = c.checkedOutAt === null;
              return (
                <li key={c.submissionId}>
                  <Link
                    href={`/check-in/confirmation/${c.submissionId}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-ink">
                        {c.siteName}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-subtle">
                        {onSite
                          ? `Checked in ${formatDateTimeUK(c.checkedInAt)}`
                          : `Checked out ${formatDateTimeUK(c.checkedOutAt!)}`}
                        {' · '}
                        {checkInReference(c.submissionId)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
                        onSite
                          ? 'bg-safe-50 text-safe-700'
                          : 'border border-line bg-surface-sunken text-ink-muted',
                      )}
                    >
                      {onSite ? 'On site' : 'Checked out'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
