import { redirect } from 'next/navigation';
import Link from 'next/link';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerIcon, type WorkerIconName } from '@/components/worker/icons';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { requireWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { listWorkerPermits } from '@/services/permits/permitService';
import { listActivePermitTypes } from '@/services/permits/permitCatalogService';
import {
  ACTIVE_PERMIT_STATUSES,
  permitStatusLabel,
  PERMIT_STATUS_BADGE,
  type PermitStatusValue,
} from '@/services/permits/permitConstants';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Worker → Permits (SC-009). The worker's active permits and history for the site
 * they're checked into, plus a picker to request a new permit. An advisory
 * register — a permit here never blocks the worker from checking in or working.
 */
export default async function WorkerPermitsPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.ACTIVE_PERMITS) redirect('/worker/dashboard');

  const [unread, permitsList, types] = await Promise.all([
    countUnreadBulletinsForWorker(site.id, worker.id),
    listWorkerPermits(worker.id),
    listActivePermitTypes(),
  ]);

  const active = permitsList.filter((p) =>
    ACTIVE_PERMIT_STATUSES.includes(p.status),
  );
  const history = permitsList.filter(
    (p) => !ACTIVE_PERMIT_STATUSES.includes(p.status),
  );

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
        title="Permits"
        description="Request a permit to work and track its approval."
      />

      <Link
        href="/worker/permits/new"
        className="mb-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm"
      >
        <WorkerIcon name="permit" className="h-5 w-5" />
        Request new permit
      </Link>

      <h2 className="mb-2 text-sm font-bold text-ink">
        Active permits{active.length ? ` (${active.length})` : ''}
      </h2>
      {active.length === 0 ? (
        <p className="mb-6 rounded-xl border border-line bg-surface-sunken px-4 py-4 text-sm text-ink-subtle">
          You have no active permits. Request one above before starting
          permit-controlled work.
        </p>
      ) : (
        <ul className="mb-6 space-y-3">
          {active.map((p) => (
            <PermitRow key={p.id} p={p} />
          ))}
        </ul>
      )}

      <h2 className="mb-2 text-sm font-bold text-ink">Other permit types</h2>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {types.map((t) => (
          <Link
            key={t.id}
            href={`/worker/permits/new?type=${t.id}`}
            className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-3 text-sm font-semibold text-ink shadow-card hover:bg-surface-sunken"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <WorkerIcon
                name={t.iconKey as WorkerIconName}
                className="h-4 w-4"
              />
            </span>
            <span className="min-w-0">{t.name}</span>
          </Link>
        ))}
      </div>

      {history.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-bold text-ink">Permit history</h2>
          <ul className="space-y-3">
            {history.map((p) => (
              <PermitRow key={p.id} p={p} />
            ))}
          </ul>
        </>
      )}
    </WorkerShell>
  );
}

function PermitRow({
  p,
}: {
  p: {
    id: string;
    reference: string;
    permitTypeName: string;
    iconKey: string;
    status: PermitStatusValue;
    submittedAt: Date;
    validUntil: Date | null;
    approvedByName: string | null;
  };
}) {
  return (
    <li>
      <Link
        href={`/worker/permits/${p.id}`}
        className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card hover:bg-surface-sunken"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <WorkerIcon name={p.iconKey as WorkerIconName} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-ink">
              {p.permitTypeName}
            </p>
            <span
              className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PERMIT_STATUS_BADGE[p.status]}`}
            >
              {permitStatusLabel(p.status)}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs text-ink-subtle">
            {p.reference}
          </p>
          <p className="text-xs text-ink-subtle">
            {p.status === 'APPROVED' && p.validUntil
              ? `Valid until ${formatDateTimeUK(p.validUntil)}`
              : `Submitted ${formatDateTimeUK(p.submittedAt)}`}
          </p>
        </div>
        <span className="shrink-0 text-ink-subtle">›</span>
      </Link>
    </li>
  );
}
