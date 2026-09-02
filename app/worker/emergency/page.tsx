import { redirect } from 'next/navigation';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader } from '@/components/worker/PanelCard';
import { WorkerIcon, type WorkerIconName } from '@/components/worker/icons';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { requireWorkerContext } from '@/services/workerDashboard/workerDashboardService';

export const dynamic = 'force-dynamic';

/**
 * Worker Dashboard → Emergency information (SC-003).
 *
 * Gathers the three emergency panels (emergency information, first aider, fire
 * assembly point) onto one screen: in an incident a worker should not have to
 * choose between three menu items. Each block still respects its own panel
 * toggle, and the page as a whole is reachable if ANY of the three is on.
 */
export default async function WorkerEmergencyPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (
    !panels.EMERGENCY_INFORMATION &&
    !panels.FIRST_AIDER &&
    !panels.FIRE_ASSEMBLY_POINT
  ) {
    redirect('/worker/dashboard');
  }

  const unread = await countUnreadBulletinsForWorker(site.id, worker.id);
  const emergencyNumber = site.emergencyNumber || '999';

  return (
    <WorkerShell
      submissionId={submission.id}
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      sites={openCheckIns}
      activeSiteId={activeSiteId}
      unreadBulletins={unread}
    >
      <WorkerPageHeader
        title="Emergency information"
        description={`What to do and who to call at ${site.name}.`}
      />

      <a
        href={`tel:${emergencyNumber.replace(/\s+/g, '')}`}
        className="touch-target mb-4 flex items-center gap-3 rounded-xl border-2 border-danger-500 bg-danger-50 px-4 py-3.5 transition-colors hover:bg-danger-50/70"
      >
        <span aria-hidden="true" className="shrink-0 text-danger-600">
          <WorkerIcon name="phone" className="h-7 w-7" />
        </span>
        <span>
          <span className="block text-sm font-medium text-danger-700">
            In an emergency, call
          </span>
          <span className="block text-2xl font-bold text-danger-700">
            {emergencyNumber}
          </span>
        </span>
      </a>

      <div className="space-y-4">
        {panels.EMERGENCY_INFORMATION && (
          <Block title="Emergency details" icon="alert">
            {site.nearestHospital ? (
              <Detail label="Nearest A&E" value={site.nearestHospital} />
            ) : (
              <Empty>No nearest A&E has been recorded for this site.</Empty>
            )}
          </Block>
        )}

        {panels.FIRE_ASSEMBLY_POINT && (
          <Block title="Fire assembly point" icon="fire">
            {site.fireAssemblyPoint ? (
              <Detail label="Muster at" value={site.fireAssemblyPoint} />
            ) : (
              <Empty>
                No fire assembly point has been recorded. Follow site signage
                and the instructions of site management.
              </Empty>
            )}
          </Block>
        )}

        {panels.FIRST_AIDER && (
          <Block title="First aider" icon="firstaid">
            {site.firstAiderName ? (
              <div className="space-y-3">
                <Detail label="Name" value={site.firstAiderName} />
                {site.firstAiderNumber && (
                  <Detail
                    label="Contact number"
                    value={site.firstAiderNumber}
                    tel
                  />
                )}
                {site.firstAiderLocation && (
                  <Detail label="Location" value={site.firstAiderLocation} />
                )}
              </div>
            ) : (
              <Empty>No first aider has been recorded for this site.</Empty>
            )}
          </Block>
        )}
      </div>
    </WorkerShell>
  );
}

function Block({
  title,
  icon,
  children,
}: {
  title: string;
  icon: WorkerIconName;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="mb-3 flex items-center gap-2.5 text-sm font-bold text-ink">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger-50 text-danger-600">
          <WorkerIcon name={icon} className="h-5 w-5" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Detail({
  label,
  value,
  tel,
}: {
  label: string;
  value: string;
  tel?: boolean;
}) {
  return (
    <div>
      {/*
        14px, and not uppercase: this is the one screen whose whole purpose is
        being read quickly, outdoors, by someone who may be under stress.
        Uppercase removes the word-shape cues a reader uses at a glance and the
        letter-spacing spreads an already-small word.
      */}
      <p className="text-sm font-medium text-ink-subtle">{label}</p>
      {tel ? (
        <a
          href={`tel:${value.replace(/\s+/g, '')}`}
          className="mt-0.5 inline-block break-words text-sm font-semibold text-brand-700 hover:underline"
        >
          {value}
        </a>
      ) : (
        <p className="mt-0.5 break-words text-sm text-ink">{value}</p>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>;
}
