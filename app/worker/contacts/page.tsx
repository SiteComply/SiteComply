import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerIcon } from '@/components/worker/icons';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import {
  requireWorkerContext,
  getWorkerSiteContacts,
} from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/** Worker Dashboard → Site contacts (SC-003). Numbers are tap-to-call. */
export default async function WorkerContactsPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.SITE_CONTACTS) redirect('/worker/dashboard');

  const [unread, contacts] = await Promise.all([
    countUnreadBulletinsForWorker(site.id, worker.id),
    getWorkerSiteContacts(site.id),
  ]);

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
        title="Site contacts"
        description={`Who to contact at ${site.name}.`}
      />

      {contacts.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-subtle shadow-card">
          No contacts have been added for this site yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-line bg-surface p-4 shadow-card"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                {c.role}
              </p>
              {c.name && (
                <p className="mt-0.5 text-base font-semibold text-ink">
                  {c.name}
                </p>
              )}
              {c.phone && (
                <a
                  href={`tel:${c.phone.replace(/\s+/g, '')}`}
                  className="touch-target mt-2 inline-flex items-center gap-2 rounded-lg border-2 border-brand-500 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  <WorkerIcon name="phone" className="h-4 w-4" />
                  {c.phone}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </WorkerShell>
  );
}
