import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { requireWorkerContext } from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/**
 * Worker Dashboard → Active permits (SC-003).
 *
 * SiteComply has no permit-to-work register yet — a digital permit system is a
 * separate REV-1 item — so this panel is OFF by default and, where a site has
 * switched it on, says so plainly rather than implying there are no permits in
 * force on site.
 */
export default async function WorkerPermitsPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.ACTIVE_PERMITS) redirect('/worker/dashboard');

  const unread = await countUnreadBulletinsForWorker(site.id, worker.id);

  return (
    <WorkerShell
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      sites={openCheckIns}
      activeSiteId={activeSiteId}
      unreadBulletins={unread}
    >
      <WorkerPageHeader title="Active permits" />
      <div className="rounded-xl border border-line bg-surface px-4 py-6 text-center shadow-card">
        <p className="text-sm font-semibold text-ink">
          Permits aren’t issued through SiteComply yet.
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Any permit to work covering your task is still issued and held on
          site. Speak to site management before starting permit-controlled work.
        </p>
      </div>
    </WorkerShell>
  );
}
