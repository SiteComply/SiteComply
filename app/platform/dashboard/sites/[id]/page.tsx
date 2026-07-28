import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/cn';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { RowLink } from '@/components/platform/RowLink';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { SiteStatusButton } from '@/components/platform/SiteStatusButton';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import { getSiteDetailForViewer } from '@/services/sites/siteDetailService';
import { pct } from '@/services/reports/complianceReport';
import { listOutstandingAuditsForSite } from '@/services/audits/auditService';
import { listBulletinsForSite } from '@/services/bulletins/bulletinService';
import { SiteBulletins } from '@/components/platform/SiteBulletins';
import { SiteContacts } from '@/components/platform/SiteContacts';
import { WorkerDashboardConfig } from '@/components/platform/WorkerDashboardConfig';
import { KnowledgeCheckConfig } from '@/components/platform/KnowledgeCheckConfig';
import { InductionValidityConfig } from '@/components/platform/InductionValidityConfig';
import { listSiteContactsForViewer } from '@/services/sites/siteContactService';
import { getPanelVisibilityForViewer } from '@/services/workerDashboard/dashboardConfigService';
import { getEffectiveConfig } from '@/services/knowledgeChecks/knowledgeCheckConfigService';
import { getBankPreviewForViewer } from '@/services/knowledgeChecks/bankAdminService';
import { getValidityForViewer } from '@/services/induction/inductionConfigService';
import { countDocuments } from '@/services/documents/documentService';
import {
  DOCUMENT_EXPIRY_BADGE,
  DOCUMENT_EXPIRY_LABEL,
} from '@/services/documents/documentConstants';
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

export const dynamic = 'force-dynamic';

/**
 * Platform → Site Details (drill-down from the Sites list). Aggregates the site's
 * information, current workers, recent submissions, audits, actions and
 * compliance. Only reachable for a site in the viewer's scope (enforced in the
 * service); each cross-module section is additionally gated by that module's view
 * permission, so it never shows data a role isn't entitled to.
 */
export default async function SiteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const detail = await getSiteDetailForViewer(viewer, params.id);
  if (!detail) notFound();

  const canViewCheckins = permits(viewer.role, 'checkins', 'view');
  const canViewAudits = permits(viewer.role, 'audits', 'view');
  const canViewActions = permits(viewer.role, 'actions', 'view');
  const canViewDocuments = permits(viewer.role, 'documents', 'view');
  const canViewBulletins = permits(viewer.role, 'bulletins', 'view');
  const canPublishBulletins = permits(viewer.role, 'bulletins', 'create');
  const canManageBulletins = permits(viewer.role, 'bulletins', 'edit');
  const canEdit = canEditSite(viewer.role);
  // SC-003: configuring the Worker Dashboard and maintaining site contacts is
  // day-to-day site management, so it follows the `sites` edit permission (which
  // site managers hold) rather than the Director-only site-record capability.
  const canConfigureDashboard = permits(viewer.role, 'sites', 'edit');
  const now = new Date();

  // Site Details focuses on outstanding audit work: only Draft / In progress /
  // Awaiting sign-off, ordered by status then longest outstanding. Signed-off
  // audits stay in the register.
  const audits = canViewAudits
    ? await listOutstandingAuditsForSite(viewer, params.id, 5)
    : [];
  // Site Details focuses on outstanding work: only Open / In progress / Overdue,
  // ordered by urgency then priority. Completed actions stay in the register.
  const actions = canViewActions
    ? await listOutstandingActionsForSite(viewer, params.id, 5, now)
    : [];
  // Document compliance for this site — expired + expiring-soon counts, scoped
  // to the site (and to the viewer's access) via the shared documents service.
  const [expiredDocs, expiringDocs] = canViewDocuments
    ? await Promise.all([
        countDocuments(viewer, { siteId: params.id, expiry: 'expired' }),
        countDocuments(viewer, { siteId: params.id, expiry: 'expiring' }),
      ])
    : [0, 0];
  // Daily Bulletins for this site (SC-002), formatted for the client panel.
  const bulletins = canViewBulletins
    ? (await listBulletinsForSite(viewer, params.id, 20)).map((b) => ({
        id: b.id,
        category: b.category,
        title: b.title,
        body: b.body,
        active: b.active,
        publishedAtLabel: formatDateTimeUK(b.publishedAt),
        createdByName: b.createdByName,
        readCount: b.readCount,
      }))
    : [];

  // Worker Dashboard (SC-003): the site's contacts and its panel configuration.
  const [siteContacts, panelVisibility] = await Promise.all([
    listSiteContactsForViewer(viewer, params.id),
    getPanelVisibilityForViewer(viewer, params.id),
  ]);

  // Knowledge check (SC-005): effective config + generated question bank preview.
  // Induction validity (SC-006): stored validity + invalidation state.
  const [kcConfig, kcPreview, inductionValidity] = canConfigureDashboard
    ? await Promise.all([
        getEffectiveConfig(params.id),
        getBankPreviewForViewer(viewer, params.id),
        getValidityForViewer(viewer, params.id),
      ])
    : [null, null, null];

  const { site, currentWorkers, recentSubmissions, compliance } = detail;
  const compliantPct = pct(compliance.compliant, compliance.total);

  return (
    <PlatformShell>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: 'Sites', href: '/platform/dashboard/sites' },
            { label: site.name },
          ]}
        />
        <Link
          href="/platform/dashboard/sites"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          ← Sites
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-ink">{site.name}</h1>
              <StatusPill
                label={site.status === 'ACTIVE' ? 'Active' : 'Archived'}
                tone={site.status === 'ACTIVE' ? 'good' : 'muted'}
              />
            </div>
            <p className="text-ink-muted">
              Ref {site.jobReference} · {site.town}, {site.postcode}
            </p>
          </div>
          {canEdit && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href={`/platform/dashboard/sites/${site.id}/edit`}
                className="touch-target inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-600"
              >
                Edit site
              </Link>
              <SiteStatusButton siteId={site.id} status={site.status} />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canViewCheckins && (
            <Section title="Compliance">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Check-ins" value={String(compliance.total)} />
                <Stat label="Compliant" value={`${compliantPct}%`} />
                <Stat label="On site now" value={String(detail.onSiteCount)} />
                <Stat
                  label="Incomplete"
                  value={String(compliance.incomplete)}
                />
              </div>
              {compliance.total > 0 && (
                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Rate
                    label="PPE"
                    n={compliance.ppe}
                    total={compliance.total}
                  />
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
          )}

          {canViewCheckins && (
            <Section
              title={`Current workers on site (${currentWorkers.length})`}
            >
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
          )}

          {canViewCheckins && (
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
          )}

          {canViewBulletins && (
            <Section title="Daily Bulletins">
              <SiteBulletins
                siteId={site.id}
                bulletins={bulletins}
                canPublish={canPublishBulletins}
                canManage={canManageBulletins}
              />
            </Section>
          )}

          {panelVisibility && (
            <Section title="Worker dashboard">
              <WorkerDashboardConfig
                siteId={site.id}
                visibility={panelVisibility}
                canEdit={canConfigureDashboard}
              />
            </Section>
          )}

          {kcConfig && kcPreview && (
            <Section title="Knowledge check">
              <KnowledgeCheckConfig
                siteId={site.id}
                canEdit={canConfigureDashboard}
                initial={{
                  enabled: kcConfig.enabled,
                  questionsPerAttempt: kcConfig.questionsPerAttempt,
                  requireManagerApproval: kcConfig.requireManagerApproval,
                  unavailablePolicy: kcConfig.unavailablePolicy,
                }}
                preview={kcPreview}
              />
            </Section>
          )}

          {inductionValidity && (
            <Section title="Induction validity">
              <InductionValidityConfig
                siteId={site.id}
                canEdit={canConfigureDashboard}
                initial={{
                  inductionValidityDays:
                    inductionValidity.inductionValidityDays,
                  invalidatedAtLabel: inductionValidity.inductionsInvalidatedAt
                    ? formatDateTimeUK(
                        inductionValidity.inductionsInvalidatedAt,
                      )
                    : null,
                  invalidatedByName: inductionValidity.invalidatedByName,
                }}
              />
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Site information">
            <dl className="space-y-3">
              <Detail label="Job reference" value={site.jobReference} />
              <Detail
                label="Address"
                value={`${site.addressLine1}, ${site.town}, ${site.postcode}`}
              />
              <Detail
                label="Status"
                value={site.status === 'ACTIVE' ? 'Active' : 'Archived'}
              />
              <Detail label="Created" value={formatDateUK(site.createdAt)} />
            </dl>
          </Section>

          <Section title="Site contacts">
            <SiteContacts
              siteId={site.id}
              contacts={siteContacts}
              canEdit={canConfigureDashboard}
            />
          </Section>

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
                href={`/platform/dashboard/audits?site=${site.id}`}
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
                href={`/platform/dashboard/actions?site=${site.id}`}
                className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
              >
                View all actions →
              </Link>
            </Section>
          )}

          {canViewDocuments && (
            <Section title="Documents">
              {expiredDocs === 0 && expiringDocs === 0 ? (
                <Empty>No document issues for this site.</Empty>
              ) : (
                <ul className="space-y-1">
                  <DocIssueRow
                    href={`/platform/dashboard/documents?site=${site.id}&expiry=expired`}
                    label={DOCUMENT_EXPIRY_LABEL.EXPIRED}
                    count={expiredDocs}
                    badge={DOCUMENT_EXPIRY_BADGE.EXPIRED}
                  />
                  <DocIssueRow
                    href={`/platform/dashboard/documents?site=${site.id}&expiry=expiring`}
                    label={DOCUMENT_EXPIRY_LABEL.EXPIRING_SOON}
                    count={expiringDocs}
                    badge={DOCUMENT_EXPIRY_BADGE.EXPIRING_SOON}
                  />
                </ul>
              )}
              <Link
                href={`/platform/dashboard/documents?site=${site.id}`}
                className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
              >
                View documents →
              </Link>
            </Section>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * One document-compliance row (Expired / Expiring soon): label + a count badge
 * that only takes its status colour when the count is non-zero, so a site with no
 * issues in that category reads calmly. Whole row links to the filtered list.
 */
function DocIssueRow({
  href,
  label,
  count,
  badge,
}: {
  href: string;
  label: string;
  count: number;
  badge: string;
}) {
  return (
    <li>
      <RowLink
        href={href}
        trailing={
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
              count > 0 ? badge : 'bg-surface-sunken text-ink-subtle',
            )}
          >
            {count}
          </span>
        }
      >
        <span className="whitespace-nowrap text-sm font-medium text-ink">
          {label}
        </span>
      </RowLink>
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <div className="text-lg font-bold tabular-nums text-ink">{value}</div>
      <div className="text-xs text-ink-subtle">{label}</div>
    </div>
  );
}

function Rate({
  label,
  n,
  total,
}: {
  label: string;
  n: number;
  total: number;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-ink">
        {pct(n, total)}%
      </dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>;
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'good' | 'warn' | 'muted';
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
        tone === 'good' && 'bg-safe-50 text-safe-700',
        tone === 'warn' && 'bg-hivis-400/25 text-ink',
        tone === 'muted' &&
          'border border-line bg-surface-sunken text-ink-muted',
      )}
    >
      {label}
    </span>
  );
}
