import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { ProjectCompletionPanel } from '@/components/platform/ProjectCompletionPanel';
import { ProjectClosureHistory } from '@/components/platform/ProjectClosureHistory';
import {
  canCloseProject,
  canReopenProject,
  listClosureEvents,
} from '@/services/projectClosure/closureService';
import { Detail, Stat } from '@/components/platform/siteDetailUi';
import { Panel } from '@/components/platform/Panel';
import {
  SITE_STATUS_LABEL,
  type SiteStatusValue,
} from '@/services/sites/siteStatusFilter';
import { formatDateUK } from '@/lib/datetime';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getSiteDetailForViewer } from '@/services/sites/siteDetailService';
import { getSiteInformationForViewer } from '@/services/sites/siteInformationService';
import { pct } from '@/services/reports/complianceReport';

export const dynamic = 'force-dynamic';

/**
 * Platform → Site Details — Overview tab (the original Site Details URL). Site
 * information and an at-a-glance summary. Workers, compliance detail, worker
 * experience and documents live on their own tabs. Scope + per-section view
 * permissions are unchanged from the former single page.
 */
export default async function SiteOverviewPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const detail = await getSiteDetailForViewer(viewer, params.id);
  if (!detail) notFound();

  const { site, compliance } = detail;
  const canViewCheckins = permits(viewer.role, 'checkins', 'view');
  const compliantPct = pct(compliance.compliant, compliance.total);

  // Site information completeness (SC-008) — a gentle nudge on the Overview.
  const siteInfo = await getSiteInformationForViewer(viewer, params.id);
  const infoComplete = siteInfo?.completeness ?? null;

  // SC-025 — completion state, controls and audit trail.
  const closureEvents = (await listClosureEvents(viewer, params.id)) ?? [];

  return (
    <PlatformShell>
      <SiteDetailHeader viewer={viewer} siteId={params.id} active="overview" />

      {/* SC-025 — a completed project says so before anything else on the page,
          so nobody starts work on records they cannot change. */}
      {site.status === 'COMPLETED' ? (
        <div className="mb-6">
          <ProjectCompletionPanel
            siteId={params.id}
            status={site.status}
            completedAt={
              site.completedAt ? site.completedAt.toISOString() : null
            }
            completedByName={site.completedByName}
            canClose={canCloseProject(viewer.role)}
            canReopen={canReopenProject(viewer.role)}
          />
        </div>
      ) : null}

      {/* UX REFRESH PHASE 4 — the Overview was a three-column grid whose
          two-column main region held one card containing four small stats and
          then stopped, leaving most of the landing page for every project empty.
          The right column carried TWO cards both headed "Site information",
          which read as a duplicate rather than as two different things.

          Now: one full-width summary strip, then the project's details laid out
          across the width. Same figures, same links, same gates — the numbers
          just stop being crammed into a third of the page. */}
      {(canViewCheckins || infoComplete) && (
        <Panel title="Project summary" className="mb-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            {canViewCheckins && (
              <>
                <Stat label="Check-ins" value={String(compliance.total)} />
                <Stat label="Compliant" value={`${compliantPct}%`} />
                <Stat label="On site now" value={String(detail.onSiteCount)} />
                <Stat
                  label="Incomplete"
                  value={String(compliance.incomplete)}
                />
              </>
            )}
            {infoComplete && (
              <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
                <div className="text-lg font-bold tabular-nums text-ink">
                  {infoComplete.complete}/{infoComplete.total}
                </div>
                <div className="text-xs text-ink-subtle">
                  Worker-facing sections
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-safe-500"
                    style={{
                      width: `${(infoComplete.complete / infoComplete.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          {infoComplete && infoComplete.missing.length > 0 && (
            <p className="mt-3 text-xs text-ink-subtle">
              Still to add on the Worker Experience tab:{' '}
              {infoComplete.missing.join(', ')}.
            </p>
          )}
        </Panel>
      )}

      <Panel title="Project details">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          <Detail label="Job reference" value={site.jobReference} />
          <Detail
            label="Address"
            value={`${site.addressLine1}, ${site.town}, ${site.postcode}`}
          />
          {/* Was `status === 'ACTIVE' ? 'Active' : 'Archived'`, which labelled an
              SC-025 COMPLETED project "Archived". Uses the module's own labels. */}
          <Detail
            label="Status"
            value={SITE_STATUS_LABEL[site.status as SiteStatusValue]}
          />
          <Detail label="Created" value={formatDateUK(site.createdAt)} />
        </dl>
      </Panel>

      {/* The close control sits at the BOTTOM for an open project: completing a
          project is a deliberate, end-of-life act, not something to fall over
          while reading the summary. */}
      {site.status !== 'COMPLETED' && canCloseProject(viewer.role) ? (
        <div className="mt-6">
          <ProjectCompletionPanel
            siteId={params.id}
            status={site.status}
            completedAt={null}
            completedByName={null}
            canClose
            canReopen={canReopenProject(viewer.role)}
          />
        </div>
      ) : null}

      {closureEvents.length > 0 ? (
        <div className="mt-6">
          <ProjectClosureHistory
            events={closureEvents.map((e) => ({
              ...e,
              createdAt: e.createdAt.toISOString(),
            }))}
          />
        </div>
      ) : null}
    </PlatformShell>
  );
}
