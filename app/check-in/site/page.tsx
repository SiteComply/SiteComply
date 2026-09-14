import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Steps } from '@/components/checkin/Steps';
import { SiteSelector } from '@/components/checkin/SiteSelector';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { listSitesForWorkerSelection } from '@/services/sites/siteService';
import { siteAccessHintsForWorker } from '@/services/workerAccess/workerAssignmentService';

export const dynamic = 'force-dynamic';

/**
 * Worker flow — step 3: choose the site you've arrived at. Enforces step order:
 * you must have verified (session) and saved your details (worker record) first.
 */
export default async function CheckInSitePage() {
  const session = getWorkerSession();
  if (!session) redirect('/check-in');

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) redirect('/check-in/details');

  // Owner Review Item 17 — only the projects this operative is on. A site
  // they have no relationship with is never fetched, so it cannot leak.
  const sites = await listSitesForWorkerSelection(worker.id);

  // A fixed number of queries for the whole list, so an operative can see which
  // of THEIR sites they can use right now — rather than picking one and being
  // turned away on the next screen. The list is already scoped to their own
  // projects; these hints explain the state of each.
  const access = await siteAccessHintsForWorker(worker.id, sites);

  return (
    <AppShell>
      <Steps current="Choose site" />
      <header className="mb-5 space-y-1">
        <h1 className="text-2xl font-bold text-ink">Choose your site</h1>
        <p className="text-sm text-ink-muted">
          Tap the site you’ve arrived at to start your induction.
        </p>
      </header>

      <SiteSelector
        sites={sites.map((s) => {
          const hint = access.get(s.id);
          return {
            ...s,
            // The full sentence is deliberately not passed: the list shows the
            // short label, and the site page states the reason in full.
            access:
              hint?.state === 'blocked'
                ? { state: 'blocked' as const, short: hint.short }
                : hint,
          };
        })}
      />
    </AppShell>
  );
}
