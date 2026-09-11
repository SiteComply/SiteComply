import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SettingsWorkspace } from '@/components/platform/SettingsWorkspace';
import { ErrorLogTable } from '@/components/platform/ErrorLogTable';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { canManageSiteConfigTemplates } from '@/services/platformUsers/platformPermissions';
import { listErrorEvents, errorSummary } from '@/services/telemetry/errorQueries';
import { RETENTION_DAYS } from '@/services/telemetry/errorLog';
import type { ErrorEventPortal } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * Owner Review Item 11 — the error log.
 *
 * A crash was reported that could not be investigated, because the only record
 * was what the person happened to write down. This is where that record lives
 * now: what failed, on which page, to whom, in which browser, on which deploy.
 *
 * Gated to the same roles as the rest of Settings. Stacks and page paths are
 * operational detail, not something every site manager needs.
 */
export default async function ErrorLogPage({
  searchParams,
}: {
  searchParams?: { portal?: string; q?: string; days?: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');
  if (!canManageSiteConfigTemplates(viewer.role)) {
    redirect('/platform/dashboard');
  }

  const PORTALS = ['PLATFORM', 'ADMIN', 'WORKER', 'PUBLIC', 'SYSTEM'];
  const portal = PORTALS.includes(searchParams?.portal ?? '')
    ? (searchParams?.portal as ErrorEventPortal)
    : null;
  const days = Number(searchParams?.days) || 30;

  // The table may not exist yet — production applies migrations by hand. An
  // empty page with an explanation beats a crash on the page built to show
  // crashes.
  let rows: Awaited<ReturnType<typeof listErrorEvents>> = [];
  let summary = { last24h: 0, last7d: 0, distinctFaults7d: 0 };
  let unavailable = false;
  try {
    [rows, summary] = await Promise.all([
      listErrorEvents({ portal, q: searchParams?.q ?? null, days }),
      errorSummary(),
    ]);
  } catch {
    unavailable = true;
  }

  return (
    <PlatformShell>
      <SettingsWorkspace active="errors">
        <ErrorLogTable
          rows={rows.map((r) => ({
            id: r.id,
            reference: r.reference,
            kind: r.kind,
            portal: r.portal,
            digest: r.digest,
            name: r.name,
            message: r.message,
            stack: r.stack,
            pagePath: r.pagePath,
            route: r.route,
            method: r.method,
            userName: r.userName,
            userRole: r.userRole,
            browser: r.browser,
            os: r.os,
            deviceType: r.deviceType,
            viewportWidth: r.viewportWidth,
            viewportHeight: r.viewportHeight,
            buildId: r.buildId,
            occurrences: r.occurrences,
            firstSeenAt: r.firstSeenAt.toISOString(),
            lastSeenAt: r.lastSeenAt.toISOString(),
          }))}
          summary={summary}
          filters={{ portal, q: searchParams?.q ?? '', days }}
          retentionDays={RETENTION_DAYS}
          unavailable={unavailable}
        />
      </SettingsWorkspace>
    </PlatformShell>
  );
}
