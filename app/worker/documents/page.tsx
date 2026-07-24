import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerDocumentList } from '@/components/worker/WorkerDocumentList';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import {
  requireWorkerContext,
  getWorkerDocuments,
} from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/**
 * Worker Dashboard → Site documents (SC-003). RAMS are excluded here because
 * they have their own panel and page, so nothing is listed (or counted) twice.
 */
export default async function WorkerDocumentsPage() {
  const { worker, submission, site, panels } = await requireWorkerContext();
  if (!panels.SITE_DOCUMENTS) redirect('/worker/dashboard');

  const [unread, documents] = await Promise.all([
    countUnreadBulletinsForWorker(site.id, worker.id),
    getWorkerDocuments(site.id, { excludeRams: true }),
  ]);

  return (
    <WorkerShell
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      unreadBulletins={unread}
    >
      <WorkerPageHeader
        title="Site documents"
        description="Paperwork for this site. RAMS have their own section."
      />
      <WorkerDocumentList
        documents={documents}
        emptyMessage="No site documents have been uploaded for this site yet."
      />
    </WorkerShell>
  );
}
