import { PlatformShell } from '@/components/platform/PlatformShell';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { ROLE_LABELS } from '@/services/platformUsers/platformUserConstants';
import { PlatformRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getCalendarWindow,
  getUpcoming,
  activityTypesIn,
} from '@/services/compliance/occurrenceService';
import { listInductedWorkers } from '@/services/actions/actionAssigneeService';
import {
  addDays,
  isoWeekday,
  londonDateStr,
} from '@/services/compliance/occurrenceGenerator';
import { ComplianceCalendarShell } from '@/components/platform/ComplianceCalendarShell';
import { ComplianceKpiStrip } from '@/components/platform/ComplianceKpiStrip';
import { getComplianceKpis } from '@/services/reports/complianceActivityReport';
import { ActivityTypeLegend } from '@/components/platform/ActivityTypeLegend';
import { UpcomingCompliance } from '@/components/platform/UpcomingCompliance';

export const dynamic = 'force-dynamic';

/**
 * SC-020 Phase 1 — the Compliance Calendar, the module's primary experience.
 *
 * Occurrence generation runs LAZILY here for the displayed window, so the
 * calendar is correct whenever it is looked at even though no scheduler exists
 * yet. Phase 4's timer will call the same generator.
 */

/** The Monday-aligned 6-week grid covering a month, as in the REV-1 example. */
function monthGrid(monthStart: string): string[] {
  const firstWeekday = isoWeekday(monthStart);
  const gridStart = addDays(monthStart, -(firstWeekday - 1));
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function shiftMonth(monthStart: string, delta: number): string {
  const [y, m] = monthStart.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export default async function ComplianceCalendarPage({
  searchParams,
}: {
  searchParams: { month?: string; site?: string };
}) {
  const viewer = await requirePlatformViewer();
  // Reuses the audits module rather than inventing a new RBAC entry — Site
  // Managers and Directors already hold audits create/edit after SC-013.
  assertModuleView(viewer, 'audits');

  const todayLocal = londonDateStr(new Date());
  const monthStart = /^\d{4}-\d{2}$/.test(searchParams.month ?? '')
    ? `${searchParams.month}-01`
    : `${todayLocal.slice(0, 7)}-01`;
  const siteId =
    searchParams.site && viewer.siteIds.includes(searchParams.site)
      ? searchParams.site
      : undefined;

  const gridDays = monthGrid(monthStart);
  const from = gridDays[0]!;
  const to = gridDays[gridDays.length - 1]!;

  const [{ occurrences }, upcoming, templates, kpis] = await Promise.all([
    getCalendarWindow(viewer, from, to, siteId),
    getUpcoming(viewer, siteId),
    prisma.auditTemplate.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: { id: true, name: true },
    }),
    // SC-020 Phase 3 — headline figures across ALL time for the scoped sites,
    // not just the displayed month: "3 overdue" should not change because you
    // paged to a different month.
    getComplianceKpis(siteId ? [siteId] : viewer.siteIds),
  ]);

  const canManage = permits(viewer.role, 'audits', 'create');

  // Two SEPARATE lists, deliberately. SC-015's getAssignablePeople offers
  // platform users only as a FALLBACK when a site has no inducted workers, which
  // is right for actions but wrong here — assigning a recurring inspection to a
  // site manager is the primary case, so platform users must always be offered.
  const peopleSiteId = siteId ?? viewer.siteIds[0];
  const [inducted, siteUsers] = await Promise.all([
    peopleSiteId ? listInductedWorkers(peopleSiteId) : Promise.resolve([]),
    peopleSiteId
      ? prisma.platformUser.findMany({
          where: {
            status: 'ACTIVE',
            assignedSites: { some: { id: peopleSiteId } },
          },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, role: true, company: true },
        })
      : Promise.resolve([]),
  ]);
  const people = [
    ...siteUsers.map((u) => ({
      kind: 'USER' as const,
      id: u.id,
      name: u.name,
      company: u.company || (ROLE_LABELS[u.role] ?? u.role),
    })),
    ...inducted.map((p) => ({
      kind: 'WORKER' as const,
      id: p.id,
      name: p.name,
      company: p.company,
    })),
  ];

  const roles = Object.keys(PlatformRole).map((r) => ({
    value: r,
    label: ROLE_LABELS[r as PlatformRole] ?? r,
  }));

  const monthLabel = new Date(`${monthStart}T12:00:00Z`).toLocaleDateString(
    'en-GB',
    { month: 'long', year: 'numeric' },
  );
  const q = (month: string) =>
    `/platform/dashboard/compliance-calendar?month=${month}${siteId ? `&site=${siteId}` : ''}`;

  return (
    <PlatformShell>
      <ComplianceCalendarShell
        monthStart={monthStart}
        monthLabel={monthLabel}
        prevHref={q(shiftMonth(monthStart, -1).slice(0, 7))}
        nextHref={q(shiftMonth(monthStart, 1).slice(0, 7))}
        todayHref={q(todayLocal.slice(0, 7))}
        gridDays={gridDays}
        items={occurrences}
        todayLocal={todayLocal}
        sites={viewer.sites.map((s) => ({ id: s.id, name: s.name }))}
        templates={templates}
        roles={roles}
        people={people}
        selectedSiteId={siteId ?? ''}
        canManage={canManage}
      />

      <div className="mt-4">
        <ComplianceKpiStrip
          kpis={kpis}
          reportHref={`/platform/dashboard/reports/compliance-activities${siteId ? `?sites=${siteId}` : ''}`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ActivityTypeLegend types={activityTypesIn(occurrences)} />
        <UpcomingCompliance
          items={upcoming}
          viewAllHref={`/platform/dashboard/compliance-calendar/schedules${siteId ? `?site=${siteId}` : ''}`}
        />
      </div>
    </PlatformShell>
  );
}
