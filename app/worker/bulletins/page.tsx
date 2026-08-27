import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { BulletinBoard } from '@/components/checkin/BulletinBoard';
import { cn } from '@/lib/cn';
import { formatDateTimeUK } from '@/lib/datetime';
import {
  bulletinCategoryLabel,
  BULLETIN_CATEGORY_BADGE,
  type BulletinCategoryValue,
} from '@/services/bulletins/bulletinConstants';
import {
  requireWorkerContext,
  getWorkerBulletins,
} from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/**
 * Worker Dashboard → Bulletins (SC-003), the full Daily Bulletin history for the
 * site. Unread bulletins stay actionable at the top (the same acknowledge card
 * used at check-in); everything already read is listed below for reference.
 */
export default async function WorkerBulletinsPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.DAILY_BULLETIN) redirect('/worker/dashboard');

  const bulletins = await getWorkerBulletins(site.id, worker.id);
  const unread = bulletins.filter((b) => !b.acknowledged);
  const read = bulletins.filter((b) => b.acknowledged);

  return (
    <WorkerShell
      submissionId={submission.id}
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      sites={openCheckIns}
      activeSiteId={activeSiteId}
      unreadBulletins={unread.length}
    >
      <WorkerPageHeader
        title="Daily Bulletin"
        description={`Notices, announcements and safety alerts for ${site.name}.`}
      />

      {bulletins.length === 0 && (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-subtle shadow-card">
          No bulletins have been published for this site.
        </p>
      )}

      {unread.length > 0 && (
        <div className="mb-5">
          <BulletinBoard
            bulletins={unread.map((b) => ({
              id: b.id,
              category: b.category,
              title: b.title,
              body: b.body,
              publishedAtLabel: formatDateTimeUK(b.publishedAt),
            }))}
          />
        </div>
      )}

      {read.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            Already read
          </h2>
          <ul className="space-y-3">
            {read.map((b) => (
              <li
                key={b.id}
                className="rounded-xl border border-line bg-surface p-4 shadow-card"
              >
                <span
                  className={cn(
                    'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
                    BULLETIN_CATEGORY_BADGE[
                      b.category as BulletinCategoryValue
                    ] ?? 'bg-surface-sunken text-ink-subtle',
                  )}
                >
                  {bulletinCategoryLabel(b.category)}
                </span>
                {b.title && (
                  <p className="mt-2 text-sm font-semibold text-ink">
                    {b.title}
                  </p>
                )}
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                  {b.body}
                </p>
                <p className="mt-2 text-xs text-ink-subtle">
                  Published {formatDateTimeUK(b.publishedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </WorkerShell>
  );
}
