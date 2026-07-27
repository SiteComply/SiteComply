import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { formatDateTimeUK } from '@/lib/datetime';
import { checkInReference } from '@/services/submissions/submissionService';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { requireWorkerContext } from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/** Worker Dashboard → Site information (SC-003). */
export default async function WorkerSiteInformationPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.SITE_INFORMATION) redirect('/worker/dashboard');

  const unread = await countUnreadBulletinsForWorker(site.id, worker.id);
  const address = [
    site.addressLine1,
    site.addressLine2,
    site.town,
    site.postcode,
  ]
    .filter(Boolean)
    .join(', ');

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
        title="Site information"
        description="The site you’re currently checked into."
      />

      <dl className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <Row label="Site" value={site.name} />
        <Row label="Site reference" value={site.jobReference} />
        <Row label="Address" value={address} />
        <Row
          label="Checked in"
          value={formatDateTimeUK(submission.checkedInAt)}
        />
        <Row
          label="Check-in reference"
          value={checkInReference(submission.id)}
          mono
        />
      </dl>
    </WorkerShell>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-ink-subtle">{label}</dt>
      <dd
        className={`text-right text-sm font-semibold text-ink ${mono ? 'font-mono tracking-wide' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
