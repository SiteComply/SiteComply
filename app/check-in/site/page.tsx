import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Steps } from '@/components/checkin/Steps';
import { SiteSelector } from '@/components/checkin/SiteSelector';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { listActiveSitesForSelection } from '@/services/sites/siteService';

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

  const sites = await listActiveSitesForSelection();

  return (
    <AppShell>
      <Steps current="Choose site" />
      <header className="mb-5 space-y-1">
        <h1 className="text-2xl font-bold text-ink">Choose your site</h1>
        <p className="text-sm text-ink-muted">
          Tap the site you’ve arrived at to start your induction.
        </p>
      </header>

      <SiteSelector sites={sites} />
    </AppShell>
  );
}
