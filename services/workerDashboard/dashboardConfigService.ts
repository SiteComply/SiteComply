import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  WORKER_DASHBOARD_PANELS,
  WORKER_DASHBOARD_PANEL_VALUES,
  defaultPanelVisibility,
  isPanelLocked,
  isWorkerDashboardPanel,
  type PanelVisibility,
  type WorkerDashboardPanelValue,
} from '@/services/workerDashboard/dashboardPanels';

/**
 * Per-site Worker Dashboard configuration (SC-003).
 *
 * Only overrides are stored (see the SiteDashboardSetting model): a site with no
 * rows uses the built-in defaults, so every existing site works with no backfill
 * and a future change to a default reaches every site that never touched that
 * panel.
 *
 * Locked panels (Check out) are forced ON on read and rejected on write, so no
 * configuration — however it was written — can leave a worker unable to end
 * their attendance record.
 */

export type { PanelVisibility };

/**
 * The effective visibility map for a site: defaults overlaid with any stored
 * overrides. This is the worker-facing read and is deliberately NOT viewer
 * scoped — the worker's own access is proven by their open check-in.
 */
export async function getPanelVisibility(
  siteId: string,
  workerId?: string,
): Promise<PanelVisibility> {
  const visibility = defaultPanelVisibility();

  const rows = await prisma.siteDashboardSetting.findMany({
    where: { jobSiteId: siteId, panel: { in: WORKER_DASHBOARD_PANEL_VALUES } },
    select: { panel: true, enabled: true },
  });
  for (const row of rows) {
    if (isWorkerDashboardPanel(row.panel)) visibility[row.panel] = row.enabled;
  }

  // SC-023 Phase 2 — per-worker overrides, applied NARROW-ONLY.
  //
  // Intersected with the site's setting, so a worker override can only ever
  // HIDE a panel the site already shows and can never reveal one it hides.
  // Applied here, where visibility is RESOLVED, so no caller can bypass it —
  // the same construction SC-022 uses for platform permissions.
  if (workerId) {
    const workerRows = await prisma.workerPanelSetting.findMany({
      where: {
        jobSiteId: siteId,
        workerId,
        panel: { in: WORKER_DASHBOARD_PANEL_VALUES },
      },
      select: { panel: true, enabled: true },
    });
    for (const row of workerRows) {
      if (!isWorkerDashboardPanel(row.panel)) continue;
      visibility[row.panel] = visibility[row.panel] && row.enabled;
    }
  }

  // A locked panel is never hidden, whatever is stored — by the site OR by a
  // per-worker override.
  for (const panel of WORKER_DASHBOARD_PANELS) {
    if (panel.locked) visibility[panel.value] = true;
  }
  return visibility;
}

/**
 * The visibility map for the configuration UI, enforcing the viewer's site
 * boundary. Returns null when the site is outside the viewer's scope.
 */
export async function getPanelVisibilityForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<PanelVisibility | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  return getPanelVisibility(siteId);
}

export type UpdatePanelVisibilityResult =
  | { ok: true; visibility: PanelVisibility }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid' };

/**
 * Set which panels a site's Worker Dashboard displays.
 *
 * Gated on the `sites` "edit" permission — the capability site managers hold for
 * their own sites (unlike creating/editing the site record itself, which is
 * Director-only). The site boundary is enforced here as defence in depth; the
 * API route checks the same permission before calling.
 *
 * Unknown keys are rejected outright rather than ignored, so a malformed request
 * can never silently half-apply. Locked panels are skipped.
 */
export async function updatePanelVisibility(
  viewer: PlatformViewer,
  siteId: string,
  updates: Record<string, unknown>,
): Promise<UpdatePanelVisibilityResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const entries: { panel: WorkerDashboardPanelValue; enabled: boolean }[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!isWorkerDashboardPanel(key)) return { ok: false, reason: 'invalid' };
    if (typeof value !== 'boolean') return { ok: false, reason: 'invalid' };
    if (isPanelLocked(key)) continue; // always on — silently keep it that way
    entries.push({ panel: key, enabled: value });
  }
  if (entries.length === 0) return { ok: false, reason: 'invalid' };

  // Guard against a race where the site was removed after the scope check.
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  await prisma.$transaction(
    entries.map((e) =>
      prisma.siteDashboardSetting.upsert({
        where: { jobSiteId_panel: { jobSiteId: siteId, panel: e.panel } },
        create: {
          jobSiteId: siteId,
          panel: e.panel,
          enabled: e.enabled,
          updatedByUserId: viewer.id,
          updatedByName: viewer.name,
        },
        update: {
          enabled: e.enabled,
          updatedByUserId: viewer.id,
          updatedByName: viewer.name,
        },
      }),
    ),
  );

  return { ok: true, visibility: await getPanelVisibility(siteId) };
}
