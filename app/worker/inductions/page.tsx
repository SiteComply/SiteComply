import Link from 'next/link';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerIcon } from '@/components/worker/icons';
import { AttendanceShell } from '@/components/attendance/AttendanceShell';
import {
  requireWorkerIdentity,
  getWorkerContext,
} from '@/services/workerDashboard/workerDashboardService';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { listWorkerInductions } from '@/services/inductionSignature/inductionRecordService';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Worker → Inductions history (SC-011). The worker's completed site inductions,
 * each opening its signed induction record. Reachable whether checked in or out
 * (reuses the attendance shell).
 */
export default async function WorkerInductionsPage() {
  const worker = await requireWorkerIdentity();
  const context = await getWorkerContext();

  const [inductions, unread] = await Promise.all([
    listWorkerInductions(worker.id),
    context
      ? countUnreadBulletinsForWorker(context.site.id, worker.id)
      : Promise.resolve(0),
  ]);

  return (
    <AttendanceShell context={context} unreadBulletins={unread}>
      <WorkerPageHeader
        title="Inductions"
        description="Your completed site inductions and signed records."
      />

      {inductions.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-sunken px-4 py-6 text-center text-sm text-ink-subtle">
          You haven’t completed any inductions yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {inductions.map((i) => (
            <li key={i.submissionId}>
              <Link
                href={`/worker/inductions/${i.submissionId}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card hover:bg-surface-sunken"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <WorkerIcon name="clipboard" className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">
                    {i.siteName}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    v{i.checklistVersion} · {formatDateTimeUK(i.completedAt)}
                  </p>
                </div>
                {i.signed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-safe-50 px-2 py-0.5 text-xs font-semibold text-safe-700">
                    <WorkerIcon name="shield" className="h-3 w-3" />
                    Signed
                  </span>
                ) : (
                  <span className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-subtle">
                    Completed
                  </span>
                )}
                <span className="shrink-0 text-ink-subtle">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AttendanceShell>
  );
}
