import { redirect } from 'next/navigation';
import { DocumentCategory } from '@prisma/client';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerDocumentList } from '@/components/worker/WorkerDocumentList';
import { documentScopeNote } from '@/services/documents/documentVisibility';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import {
  requireWorkerContext,
  getWorkerDocuments,
} from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/** Worker Dashboard → RAMS (SC-003): the site's risk assessments & method statements. */
export default async function WorkerRamsPage() {
  const {
    worker,
    submission,
    site,
    panels,
    openCheckIns,
    activeSiteId,
    cscsRemediation,
    siteCompany,
  } = await requireWorkerContext();
  if (!panels.RAMS) redirect('/worker/dashboard');

  const [unread, documents] = await Promise.all([
    countUnreadBulletinsForWorker(site.id, worker.id),
    getWorkerDocuments(site.id, {
      category: DocumentCategory.RAMS,
      // Their company's RAMS plus anything site-wide - never another
      // contractor's method statements.
      siteCompanyId: siteCompany?.id ?? null,
    }),
  ]);

  return (
    <WorkerShell
      cscsRemediation={cscsRemediation}
      submissionId={submission.id}
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      sites={openCheckIns}
      activeSiteId={activeSiteId}
      unreadBulletins={unread}
    >
      <WorkerPageHeader
        title="RAMS"
        description={documentScopeNote(siteCompany?.name)}
      />
      <WorkerDocumentList
        documents={documents}
        showCategory={false}
        emptyMessage="No RAMS have been uploaded for this site yet."
      />
    </WorkerShell>
  );
}
