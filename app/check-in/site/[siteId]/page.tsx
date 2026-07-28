import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Steps } from '@/components/checkin/Steps';
import { Button } from '@/components/ui/Button';
import { ExpressCheckInButton } from '@/components/checkin/ExpressCheckInButton';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { getActiveSiteWithChecklist } from '@/services/sites/siteService';
import { getInductionValidity } from '@/services/induction/inductionValidityService';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Worker flow — the chosen site's induction landing.
 *
 * SC-006: if the site sets an induction validity period and the worker's last
 * induction is still valid, they can check in directly (express check-in) without
 * repeating the induction; the completion + expiry dates are shown. If it has
 * expired or a manager has invalidated previous inductions, the worker is told
 * (with dates) and must complete the latest induction — the SC-005 knowledge
 * check included. Where no validity is configured, this behaves exactly as before.
 */
export default async function SiteInductionPage({
  params,
}: {
  params: { siteId: string };
}) {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) redirect('/check-in/details');

  const site = await getActiveSiteWithChecklist(params.siteId);
  if (!site) redirect('/check-in/site');

  const itemCount = site.checklist?.items.length ?? 0;
  const validity = await getInductionValidity(worker.id, site.id);

  const startHref = `/check-in/site/${site.id}/induction`;

  return (
    <AppShell>
      <Steps current="Induction" />

      <header className="mb-4 space-y-1">
        <h1 className="text-2xl font-bold text-ink">{site.name}</h1>
        <p className="text-sm text-ink-subtle">
          Ref {site.jobReference} · {site.town}, {site.postcode}
        </p>
      </header>

      {/* SC-006 validity banners */}
      {validity.enabled && validity.state === 'valid' && (
        <section className="mb-4 overflow-hidden rounded-xl border border-safe-500/40 bg-safe-50 shadow-card">
          <div className="flex items-start gap-3 p-4">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-safe-600 text-white"
            >
              ✓
            </span>
            <div>
              <h2 className="text-sm font-bold text-safe-700">
                Your induction is still valid
              </h2>
              <p className="text-sm text-safe-700/90">
                You don’t need to complete the induction again — just check in.
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-safe-500/20 border-t border-safe-500/20 bg-surface/50 text-center">
            <ValidityStat
              label="Induction completed"
              value={formatDateTimeUK(validity.completedAt)}
            />
            <ValidityStat
              label="Valid until"
              value={formatDateUK(validity.expiresAt)}
            />
          </dl>
        </section>
      )}

      {validity.enabled && validity.state === 'expired' && (
        <section className="mb-4 overflow-hidden rounded-xl border border-hivis-500 bg-hivis-400/15 shadow-card">
          <div className="flex items-start gap-3 p-4">
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-hivis-600">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-7 w-7"
              >
                <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
                <path d="M12 9.5v4M12 17h.01" />
              </svg>
            </span>
            <div>
              <h2 className="text-sm font-bold text-ink">Induction required</h2>
              <p className="text-sm text-ink-muted">
                {validity.reason === 'invalidated'
                  ? 'This site’s induction has been updated. You must complete the latest induction before you can check in.'
                  : 'Your induction for this site has expired. You must complete the latest induction before you can check in.'}
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-hivis-500/30 border-t border-hivis-500/30 bg-surface/50 text-center">
            <ValidityStat
              label="Last induction completed"
              value={formatDateUK(validity.completedAt)}
            />
            <ValidityStat
              label={
                validity.reason === 'invalidated' ? 'Invalidated' : 'Expired'
              }
              value={formatDateUK(validity.expiresAt)}
            />
          </dl>
        </section>
      )}

      {site.inductionContent && (
        <section className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-1 text-sm font-semibold text-ink">
            Site induction
          </h2>
          <p className="whitespace-pre-line text-sm text-ink-muted">
            {site.inductionContent}
          </p>
        </section>
      )}

      {(site.fireAssemblyPoint || site.firstAiderName) && (
        <section className="mb-4 rounded-xl border border-hivis-500 bg-hivis-400/15 p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Emergency information
          </h2>
          <dl className="space-y-1 text-sm text-ink-muted">
            {site.fireAssemblyPoint && (
              <div>
                <dt className="inline font-medium text-ink">
                  Fire assembly point:{' '}
                </dt>
                <dd className="inline">{site.fireAssemblyPoint}</dd>
              </div>
            )}
            {site.firstAiderName && (
              <div>
                <dt className="inline font-medium text-ink">First aider: </dt>
                <dd className="inline">
                  {site.firstAiderName}
                  {site.firstAiderNumber ? ` · ${site.firstAiderNumber}` : ''}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {validity.enabled && validity.state === 'valid' ? (
        <>
          <p className="mb-4 text-sm text-ink-muted">
            Checking in as{' '}
            <span className="font-semibold text-ink">{worker.fullName}</span> (
            {worker.company}).
          </p>
          <ExpressCheckInButton siteId={site.id} />
          <p className="mt-3 text-center text-xs text-ink-subtle">
            Need to run through the induction again?{' '}
            <Link href={startHref} className="font-semibold text-brand-700">
              Start induction
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-muted">
            Checking in as{' '}
            <span className="font-semibold text-ink">{worker.fullName}</span> (
            {worker.company}). Your induction has{' '}
            <span className="font-semibold text-ink">{itemCount}</span> quick
            checks and takes under two minutes.
          </p>
          <Link href={startHref} className="block">
            <Button size="lg" fullWidth>
              Start induction
            </Button>
          </Link>
        </>
      )}
    </AppShell>
  );
}

function ValidityStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
