import Link from 'next/link';
import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { requireWorkerContext } from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/**
 * Worker Dashboard → Messages and notifications (SC-003).
 *
 * There is no worker-facing messaging or notification store in SiteComply yet,
 * so this panel is OFF by default. Where a site has switched it on, it points
 * the worker at Daily Bulletins — the channel that does carry site messages —
 * rather than showing an empty inbox that implies nobody has written to them.
 */
export default async function WorkerMessagesPage() {
  const { worker, submission, site, panels } = await requireWorkerContext();
  if (!panels.MESSAGES) redirect('/worker/dashboard');

  const unread = await countUnreadBulletinsForWorker(site.id, worker.id);

  return (
    <WorkerShell
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      unreadBulletins={unread}
    >
      <WorkerPageHeader title="Messages and notifications" />
      <div className="rounded-xl border border-line bg-surface px-4 py-6 text-center shadow-card">
        <p className="text-sm font-semibold text-ink">
          Direct messaging isn’t available yet.
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Site messages are published as Daily Bulletins.
        </p>
        {panels.DAILY_BULLETIN && (
          <Link
            href="/worker/bulletins"
            className="touch-target mt-3 inline-flex items-center rounded-lg border-2 border-brand-500 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            View bulletins
          </Link>
        )}
      </div>
    </WorkerShell>
  );
}
