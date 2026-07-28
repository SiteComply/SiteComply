import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { WorkerShell } from '@/components/worker/WorkerShell';
import type { WorkerContext } from '@/services/workerDashboard/workerDashboardService';

/**
 * Shell for the Attendance History pages (SC-010). Attendance must be readable
 * whether or not the worker is currently on site:
 *   - checked IN  → the full WorkerShell (with the worker nav), so Attendance is
 *     one tap away like every other section;
 *   - checked OUT → the plain AppShell (as the worker home hub uses), so a
 *     signed-in worker can still review past attendance after checking out.
 */
export function AttendanceShell({
  context,
  unreadBulletins = 0,
  children,
}: {
  context: WorkerContext | null;
  unreadBulletins?: number;
  children: ReactNode;
}) {
  if (context) {
    return (
      <WorkerShell
        siteName={context.site.name}
        checkedInAt={context.submission.checkedInAt}
        panels={context.panels}
        sites={context.openCheckIns}
        activeSiteId={context.activeSiteId}
        unreadBulletins={unreadBulletins}
      >
        {children}
      </WorkerShell>
    );
  }
  return (
    <AppShell
      topBarRight={
        <a
          href="/api/worker/logout"
          className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
        >
          Sign out
        </a>
      }
    >
      {children}
    </AppShell>
  );
}
