import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Steps } from '@/components/checkin/Steps';
import { Button } from '@/components/ui/Button';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { getActiveSiteWithChecklist } from '@/services/sites/siteService';

export const dynamic = 'force-dynamic';

/**
 * Worker flow — the chosen site's induction landing.
 *
 * Stage 4 brings the worker here in ≤3 taps after login and confirms the site,
 * its emergency info and what the induction will cover. The dynamic checklist
 * rendering and submission are built in Stages 5–6.
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

  return (
    <AppShell>
      <Steps current="Induction" />

      <header className="mb-4 space-y-1">
        <h1 className="text-2xl font-bold text-ink">{site.name}</h1>
        <p className="text-sm text-ink-subtle">
          Ref {site.jobReference} · {site.town}, {site.postcode}
        </p>
      </header>

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

      <p className="mb-4 text-sm text-ink-muted">
        Checking in as{' '}
        <span className="font-semibold text-ink">{worker.fullName}</span> (
        {worker.company}). Your induction has{' '}
        <span className="font-semibold text-ink">{itemCount}</span> quick checks
        and takes under two minutes.
      </p>

      <Link href={`/check-in/site/${site.id}/induction`} className="block">
        <Button size="lg" fullWidth>
          Start induction
        </Button>
      </Link>
    </AppShell>
  );
}
