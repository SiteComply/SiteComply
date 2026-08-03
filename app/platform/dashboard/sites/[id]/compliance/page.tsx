import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cn } from '@/lib/cn';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { RowLink } from '@/components/platform/RowLink';
import { Section, Empty, Rate } from '@/components/platform/siteDetailUi';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getSiteDetailForViewer } from '@/services/sites/siteDetailService';
import { listOutstandingAuditsForSite } from '@/services/audits/auditService';
import { listOutstandingActionsForSite } from '@/services/actions/actionService';
import {
  auditStatusLabel,
  AUDIT_STATUS_BADGE,
  type AuditStatusValue,
} from '@/services/audits/auditConstants';
import {
  actionStatusLabel,
  actionPriorityLabel,
  ACTION_STATUS_BADGE,
  ACTION_PRIORITY_BADGE,
  ACTION_OVERDUE_BADGE,
  type ActionStatusValue,
  type ActionPriorityValue,
} from '@/services/actions/actionConstants';
import { SiteServicesConfig } from '@/components/platform/SiteServicesConfig';
import { getSiteServiceConfig } from '@/services/siteServices/siteServiceAvailability';
import { listActiveConfigTemplates } from '@/services/siteServices/siteConfigTemplateService';
import { prisma } from '@/lib/prisma';
import { formatDateUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Platform → Site Details — Compliance tab: induction compliance rates plus the
 * site's outstanding audits and corrective actions. Each block keeps its own view
 * permission, exactly as on the former single page.
 */
export default async function SiteCompliancePage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const canViewCheckins = permits(viewer.role, 'checkins', 'view');
  const canViewAudits = permits(viewer.role, 'audits', 'view');
  const canViewActions = permits(viewer.role, 'actions', 'view');
  if (!canViewCheckins && !canViewAudits && !canViewActions) {
    redirect(`/platform/dashboard/sites/${params.id}`);
  }

  const detail = await getSiteDetailForViewer(viewer, params.id);
  if (!detail) notFound();
  const { compliance } = detail;
  const now = new Date();

  const audits = canViewAudits
    ? await listOutstandingAuditsForSite(viewer, params.id, 5)
    : [];
  const actions = canViewActions
    ? await listOutstandingActionsForSite(viewer, params.id, 5, now)
    : [];

  // SC-021 — which permits and inspections this site uses. Read is open to
  // anyone who can see the tab; editing is gated on sites:edit, enforced in the
  // service and the API as well as here.
  const canEditServices = permits(viewer.role, 'sites', 'edit');
  const serviceGroups = (await getSiteServiceConfig(viewer, params.id)) ?? [];
  // SC-021 Phase 2 — templates available to apply, and what this site was last
  // configured from.
  const configTemplates = canEditServices
    ? (await listActiveConfigTemplates()).map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category as string,
      }))
    : [];
  const siteProvenance = await prisma.jobSite.findUnique({
    where: { id: params.id },
    select: {
      appliedConfigTemplateName: true,
      appliedConfigTemplateAt: true,
      appliedConfigTemplateBy: true,
    },
  });
  const provenance = siteProvenance?.appliedConfigTemplateName
    ? {
        name: siteProvenance.appliedConfigTemplateName,
        at: formatDateUK(siteProvenance.appliedConfigTemplateAt!),
        by: siteProvenance.appliedConfigTemplateBy,
      }
    : null;

  return (
    <PlatformShell>
      <SiteDetailHeader
        viewer={viewer}
        siteId={params.id}
        active="compliance"
      />

      {/* UX REFRESH PHASE 4 — three different altitudes were interleaved in one
          two-column grid: a compliance READING, two lists of OUTSTANDING WORK,
          and a block of CONFIGURATION. Separated here — status across the top,
          work side by side beneath it, configuration behind a disclosure because
          it is something you set up once, not something you check. */}
      {canViewCheckins && (
        <div className="mb-4">
          <Section title="Induction compliance">
            {compliance.total === 0 ? (
              <Empty>No check-ins recorded for this site yet.</Empty>
            ) : (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Rate label="PPE" n={compliance.ppe} total={compliance.total} />
                <Rate
                  label="Site rules"
                  n={compliance.rules}
                  total={compliance.total}
                />
                <Rate
                  label="Safe working"
                  n={compliance.safe}
                  total={compliance.total}
                />
                <Rate
                  label="GDPR consent"
                  n={compliance.gdpr}
                  total={compliance.total}
                />
              </dl>
            )}
          </Section>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {canViewAudits && (
          <Section title="Outstanding audits">
            {audits.length === 0 ? (
              <Empty>No outstanding audits for this site.</Empty>
            ) : (
              <ul className="space-y-1">
                {audits.map((a) => (
                  <li key={a.id}>
                    <RowLink
                      href={`/platform/dashboard/audits/${a.id}`}
                      trailing={
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-semibold',
                            AUDIT_STATUS_BADGE[a.status as AuditStatusValue],
                          )}
                        >
                          {auditStatusLabel(a.status)}
                        </span>
                      }
                    >
                      <span className="block truncate font-medium text-brand-700">
                        {a.title}
                      </span>
                    </RowLink>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/platform/dashboard/audits?site=${params.id}`}
              className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
            >
              View all audits →
            </Link>
          </Section>
        )}

        {canViewActions && (
          <Section title="Outstanding actions">
            {actions.length === 0 ? (
              <Empty>No outstanding actions for this site.</Empty>
            ) : (
              <ul className="space-y-1">
                {actions.map((a) => {
                  const overdue = a.dueDate != null && a.dueDate < now;
                  return (
                    <li key={a.id}>
                      <RowLink
                        href={`/platform/dashboard/actions/${a.id}`}
                        trailing={
                          <>
                            {overdue && (
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                                  ACTION_OVERDUE_BADGE,
                                )}
                              >
                                Overdue
                              </span>
                            )}
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-semibold',
                                ACTION_PRIORITY_BADGE[
                                  a.priority as ActionPriorityValue
                                ],
                              )}
                            >
                              {actionPriorityLabel(a.priority)}
                            </span>
                            <span
                              className={cn(
                                'hidden rounded-full px-2 py-0.5 text-xs font-semibold sm:inline',
                                ACTION_STATUS_BADGE[
                                  a.status as ActionStatusValue
                                ],
                              )}
                            >
                              {actionStatusLabel(a.status)}
                            </span>
                          </>
                        }
                      >
                        <span className="block truncate font-medium text-brand-700">
                          {a.title}
                        </span>
                      </RowLink>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              href={`/platform/dashboard/actions?site=${params.id}`}
              className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
            >
              View all actions →
            </Link>
          </Section>
        )}
      </div>

      <details className="group mt-4 rounded-xl border border-line bg-surface shadow-card">
        <summary className="touch-target cursor-pointer list-none px-4 py-3 text-sm font-bold text-ink marker:content-none">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="text-ink-subtle transition-transform group-open:rotate-90"
            >
              ›
            </span>
            Permits and inspections used on this site
          </span>
          <span className="mt-0.5 block pl-5 text-xs font-normal text-ink-subtle">
            Everything is available until you turn it off. Turning something off
            removes it from new work only — records already raised stay visible
            and keep appearing in reports.
          </span>
        </summary>
        <div className="border-t border-line p-4">
          <SiteServicesConfig
            siteId={params.id}
            groups={serviceGroups}
            canEdit={canEditServices}
            templates={configTemplates}
            provenance={provenance}
          />
        </div>
      </details>
    </PlatformShell>
  );
}
