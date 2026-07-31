import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { PermitRequestForm } from '@/components/permits/PermitRequestForm';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { requireWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { listActivePermitTypesWithQuestions } from '@/services/permits/permitCatalogService';

export const dynamic = 'force-dynamic';

/** Worker → Permits → Request a new permit (SC-009). */
export default async function NewPermitPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.ACTIVE_PERMITS) redirect('/worker/dashboard');

  const [unread, types] = await Promise.all([
    countUnreadBulletinsForWorker(site.id, worker.id),
    // SC-021: only the permit types this site makes available.
    listActivePermitTypesWithQuestions(site.id),
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
        title="Request a permit"
        description="Choose a permit type and complete the details for approval."
      />
      <PermitRequestForm types={types} initialTypeId={searchParams.type} />
    </WorkerShell>
  );
}
