import { Fragment } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cn } from '@/lib/cn';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SiteDetailHeader } from '@/components/platform/SiteDetailHeader';
import { Section, Empty, Rate } from '@/components/platform/siteDetailUi';
import {
  WorkSurface,
  RailDetail,
  selectedRowClass,
  resolveSelected,
} from '@/components/platform/WorkSurface';
import {
  sortOutstandingWork,
  urgencyBucket,
  type UrgencyBucket,
} from '@/components/platform/outstandingWorkOrder';
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
  type ActionStatusValue,
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
const URGENCY_LABEL: Record<UrgencyBucket, string> = {
  overdue: 'Overdue',
  'due-today': 'Due today',
  upcoming: 'Upcoming',
  undated: 'No due date',
};

export default async function SiteCompliancePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { item?: string };
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

  /**
   * UX REFRESH PHASE 5b — one outstanding-work surface.
   *
   * The two lists were organised by DATA SOURCE — one panel per query — while
   * the manager is asking a single question: "what needs doing on this site?"
   * Two lists side by side are still two lists, however large the card.
   *
   * PERMISSIONS ARE NOT MERGED, ONLY ROWS. `audits` is already [] unless
   * canViewAudits and `actions` is already [] unless canViewActions, so the
   * merged array inherits both gates by construction. A viewer with actions but
   * not audits sees only actions, and nothing on screen suggests rows were
   * filtered out.
   *
   * Ids are PREFIXED by kind: an audit and an action could otherwise share an id
   * and `?item=` would select the wrong record.
   *
   * NOTE ON ORDER: the agreed order is Overdue → Due today → Due date →
   * Priority, and audits have NO due date in the schema, so every audit falls in
   * the undated bucket and sorts last. Rather than let that silently bury them,
   * the list is grouped by urgency with visible headings, so "No due date" is
   * stated rather than merely happening.
   */
  const workRows = [
    ...audits.map((a) => ({
      id: `audit:${a.id}`,
      kind: 'audit' as const,
      title: a.title,
      dueDate: null,
      priority: null,
      statusLabel: auditStatusLabel(a.status),
      statusBadge: AUDIT_STATUS_BADGE[a.status as AuditStatusValue],
      href: `/platform/dashboard/audits/${a.id}`,
      createdAt: a.createdAt,
      assignedTo: null as string | null,
      assignedToCompany: null as string | null,
      raisedFromAudit: false,
    })),
    ...actions.map((a) => ({
      id: `action:${a.id}`,
      kind: 'action' as const,
      title: a.title,
      dueDate: a.dueDate,
      priority: a.priority as string | null,
      statusLabel: actionStatusLabel(a.status),
      statusBadge: ACTION_STATUS_BADGE[a.status as ActionStatusValue],
      href: `/platform/dashboard/actions/${a.id}`,
      createdAt: a.createdAt,
      assignedTo: a.assignedTo,
      assignedToCompany: a.assignedToCompany,
      raisedFromAudit: a.auditFindingId != null,
    })),
  ];
  const work = sortOutstandingWork(workRows, now);
  const selectedWork = resolveSelected(searchParams?.item, work);
  const compliancePath = `/platform/dashboard/sites/${params.id}/compliance`;

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

      {/* UX REFRESH PHASE 10 — the rail only renders when something is selected,
          so the old ternary's "nothing selected" title ("Outstanding work")
          could never appear. One title, for the one state that shows it. */}
      <WorkSurface
        railTitle="Selected item"
        railEmpty="Select an item to see its details."
        rail={
          selectedWork && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                {selectedWork.kind === 'audit' ? 'Audit' : 'Action'}
              </p>
              <p className="mb-2 text-base font-semibold text-ink">
                {selectedWork.title}
              </p>
              <dl>
                <RailDetail
                  label="Status"
                  value={
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                        selectedWork.statusBadge,
                      )}
                    >
                      {selectedWork.statusLabel}
                    </span>
                  }
                />
                <RailDetail
                  label="Due"
                  value={
                    selectedWork.dueDate
                      ? formatDateUK(selectedWork.dueDate)
                      : 'No due date'
                  }
                />
                {selectedWork.priority && (
                  <RailDetail
                    label="Priority"
                    value={actionPriorityLabel(selectedWork.priority)}
                  />
                )}
                {selectedWork.kind === 'action' && (
                  <RailDetail
                    label="Assigned to"
                    value={
                      selectedWork.assignedTo
                        ? selectedWork.assignedToCompany
                          ? `${selectedWork.assignedTo} · ${selectedWork.assignedToCompany}`
                          : selectedWork.assignedTo
                        : 'Nobody yet'
                    }
                  />
                )}
                <RailDetail
                  label="Raised"
                  value={formatDateUK(selectedWork.createdAt)}
                />
                {selectedWork.raisedFromAudit && (
                  <RailDetail
                    label="Origin"
                    value="Raised from an audit finding"
                  />
                )}
              </dl>
              <Link
                href={selectedWork.href}
                className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
              >
                Open {selectedWork.kind === 'audit' ? 'audit' : 'action'} →
              </Link>
            </>
          )
        }
        footer={
          <div className="flex flex-wrap gap-4 border-t border-line px-5 py-3 text-sm">
            {canViewAudits && (
              <Link
                href={`/platform/dashboard/audits?site=${params.id}`}
                className="font-semibold text-brand-700 hover:underline"
              >
                View all audits →
              </Link>
            )}
            {canViewActions && (
              <Link
                href={`/platform/dashboard/actions?site=${params.id}`}
                className="font-semibold text-brand-700 hover:underline"
              >
                View all actions →
              </Link>
            )}
          </div>
        }
      >
        {work.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">
            Nothing outstanding for this site.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Item</th>
                  <th className="px-5 py-2.5 font-medium">Type</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {work.map((row, i) => {
                  const bucket = urgencyBucket(row, now);
                  const isSelected = selectedWork?.id === row.id;
                  // A heading whenever the urgency changes, so a row's position
                  // is explained rather than merely happening.
                  const startsBucket =
                    i === 0 || urgencyBucket(work[i - 1]!, now) !== bucket;
                  return (
                    <Fragment key={row.id}>
                      {startsBucket && (
                        <tr className="bg-surface-sunken">
                          <th
                            colSpan={4}
                            scope="colgroup"
                            className="px-5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle"
                          >
                            {URGENCY_LABEL[bucket]}
                          </th>
                        </tr>
                      )}
                      <tr
                        className={selectedRowClass(isSelected)}
                        aria-current={isSelected ? 'true' : undefined}
                      >
                        <td className="px-5 py-3">
                          <Link
                            href={`${compliancePath}?item=${encodeURIComponent(row.id)}`}
                            className="font-semibold text-brand-700 hover:underline"
                          >
                            {row.title}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {row.kind === 'audit' ? 'Audit' : 'Action'}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                              row.statusBadge,
                            )}
                          >
                            {row.statusLabel}
                          </span>
                        </td>
                        <td
                          className={cn(
                            'px-5 py-3 tabular-nums',
                            bucket === 'overdue'
                              ? 'font-semibold text-danger-700'
                              : 'text-ink-muted',
                          )}
                        >
                          {row.dueDate ? formatDateUK(row.dueDate) : '—'}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </WorkSurface>

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
