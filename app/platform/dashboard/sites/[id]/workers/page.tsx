import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { RowLink } from '@/components/platform/RowLink';
import { Section, Empty, StatusPill } from '@/components/platform/siteDetailUi';
import { formatDateTimeUK } from '@/lib/datetime';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getSiteDetailForViewer } from '@/services/sites/siteDetailService';

export const dynamic = 'force-dynamic';

/** Platform → Site Details — Workers tab: on-site now + recent check-ins. */
export default async function SiteWorkersPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!permits(viewer.role, 'checkins', 'view')) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const detail = await getSiteDetailForViewer(viewer, params.id);
  if (!detail) notFound();

  const { currentWorkers, recentSubmissions } = detail;

  return (
    <PlatformShell>
      <SiteDetailHeader viewer={viewer} siteId={params.id} active="workers" />

      <div className="space-y-6">
        <Section title={`Current workers on site (${currentWorkers.length})`}>
          {currentWorkers.length === 0 ? (
            <Empty>No workers are currently checked in.</Empty>
          ) : (
            <ul className="space-y-1">
              {currentWorkers.map((w) => (
                <li key={w.workerId}>
                  <RowLink
                    href={`/platform/dashboard/workers/${w.workerId}`}
                    trailing={
                      <span className="text-xs tabular-nums text-ink-subtle">
                        In {formatDateTimeUK(w.checkedInAt)}
                      </span>
                    }
                  >
                    <span className="truncate font-medium text-brand-700">
                      {w.fullName}
                    </span>
                    <span className="block truncate text-xs text-ink-subtle">
                      {w.company}
                    </span>
                  </RowLink>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent check-ins">
          {recentSubmissions.length === 0 ? (
            <Empty>No check-ins recorded for this site yet.</Empty>
          ) : (
            <ul className="space-y-1">
              {recentSubmissions.map((s) => (
                <li key={s.id}>
                  <RowLink
                    href={`/platform/dashboard/workers/${s.workerId}`}
                    trailing={
                      <>
                        <StatusPill
                          label={
                            s.status === 'COMPLIANT'
                              ? 'Compliant'
                              : 'Incomplete'
                          }
                          tone={s.status === 'COMPLIANT' ? 'good' : 'warn'}
                        />
                        <span className="hidden text-xs tabular-nums text-ink-subtle sm:inline">
                          {formatDateTimeUK(s.checkedInAt)}
                        </span>
                      </>
                    }
                  >
                    <span className="truncate font-medium text-brand-700">
                      {s.workerName}
                    </span>
                    <span className="block truncate text-xs text-ink-subtle">
                      {s.company}
                    </span>
                  </RowLink>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </PlatformShell>
  );
}
