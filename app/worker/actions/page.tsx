import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { cn } from '@/lib/cn';
import { formatDateUK } from '@/lib/datetime';
import {
  actionPriorityLabel,
  actionStatusLabel,
  ACTION_PRIORITY_BADGE,
  ACTION_STATUS_BADGE,
  ACTION_OVERDUE_BADGE,
  type ActionPriorityValue,
  type ActionStatusValue,
} from '@/services/actions/actionConstants';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import {
  requireWorkerContext,
  getWorkerOutstandingActions,
} from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/**
 * Worker Dashboard → Outstanding actions (SC-003).
 *
 * Read-only and deliberately sparse: title, priority, status and due date. The
 * assignee, description, completion notes and evidence attached to an action are
 * management data and stay in the Platform.
 */
export default async function WorkerActionsPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.OUTSTANDING_ACTIONS) redirect('/worker/dashboard');

  const [unread, actions] = await Promise.all([
    countUnreadBulletinsForWorker(site.id, worker.id),
    getWorkerOutstandingActions(site.id),
  ]);
  const now = new Date();

  return (
    <WorkerShell
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      sites={openCheckIns}
      activeSiteId={activeSiteId}
      unreadBulletins={unread}
    >
      <WorkerPageHeader
        title="Outstanding actions"
        description={`Corrective actions still open at ${site.name}.`}
      />

      {actions.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-subtle shadow-card">
          There are no outstanding actions for this site.
        </p>
      ) : (
        <ul className="space-y-3">
          {actions.map((a) => {
            const overdue = a.dueDate != null && a.dueDate < now;
            return (
              <li
                key={a.id}
                className="rounded-xl border border-line bg-surface p-4 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {overdue && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        ACTION_OVERDUE_BADGE,
                      )}
                    >
                      Overdue
                    </span>
                  )}
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold',
                      ACTION_PRIORITY_BADGE[a.priority as ActionPriorityValue],
                    )}
                  >
                    {actionPriorityLabel(a.priority)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold',
                      ACTION_STATUS_BADGE[a.status as ActionStatusValue],
                    )}
                  >
                    {actionStatusLabel(a.status)}
                  </span>
                </div>
                <p className="mt-2 text-base font-semibold text-ink">
                  {a.title}
                </p>
                {a.dueDate && (
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    Due {formatDateUK(a.dueDate)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </WorkerShell>
  );
}
