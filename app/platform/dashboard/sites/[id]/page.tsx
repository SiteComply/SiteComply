import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/cn';
import { formatDateTimeUK, formatDateUK } from '@/lib/datetime';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { RowLink } from '@/components/platform/RowLink';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getSiteDetailForViewer } from '@/services/sites/siteDetailService';
import { pct } from '@/services/reports/complianceReport';
import { listAudits } from '@/services/audits/auditService';
import { listActions } from '@/services/actions/actionService';
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

  const audits = canViewAudits
    ? await listAudits(viewer, { siteId: params.id, take: 5 })
    : [];
  const actions = canViewActions
    ? await listActions(viewer, { siteId: params.id, take: 5 })
    : [];

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
                  <Rate label="PPE" n={compliance.ppe} total={compliance.total} />
                  <Rate label="Site rules" n={compliance.rules} total={compliance.total} />
                  <Rate label="Safe working" n={compliance.safe} total={compliance.total} />
                  <Rate label="GDPR consent" n={compliance.gdpr} total={compliance.total} />
                </dl>
              )}
            </Section>
          )}

          {canViewCheckins && (
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
                        <span className="truncate font-medium text-brand-700">{w.fullName}</span>
                        <span className="block truncate text-xs text-ink-subtle">{w.company}</span>
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
                              label={s.status === 'COMPLIANT' ? 'Compliant' : 'Incomplete'}
                              tone={s.status === 'COMPLIANT' ? 'good' : 'warn'}
                            />
                            <span className="hidden text-xs tabular-nums text-ink-subtle sm:inline">
                              {formatDateTimeUK(s.checkedInAt)}
                            </span>
                          </>
                        }
                      >
                        <span className="truncate font-medium text-brand-700">{s.workerName}</span>
                        <span className="block truncate text-xs text-ink-subtle">{s.company}</span>
                      </RowLink>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Site information">
            <dl className="space-y-3">
              <Detail label="Job reference" value={site.jobReference} />
              <Detail label="Address" value={`${site.addressLine1}, ${site.town}, ${site.postcode}`} />
              <Detail label="Status" value={site.status === 'ACTIVE' ? 'Active' : 'Archived'} />
              <Detail label="Created" value={formatDateUK(site.createdAt)} />
            </dl>
          </Section>

          {canViewAudits && (
            <Section title="Audits">
              {audits.length === 0 ? (
                <Empty>No audits for this site.</Empty>
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
                        <span className="block truncate font-medium text-brand-700">{a.title}</span>
                      </RowLink>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {canViewActions && (
            <Section title="Actions">
              {actions.length === 0 ? (
                <Empty>No actions for this site.</Empty>
              ) : (
                <ul className="space-y-1">
                  {actions.map((a) => (
                    <li key={a.id}>
                      <RowLink
                        href={`/platform/dashboard/actions/${a.id}`}
                        trailing={
                          <>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-semibold',
                                ACTION_PRIORITY_BADGE[a.priority as ActionPriorityValue],
                              )}
                            >
                              {actionPriorityLabel(a.priority)}
                            </span>
                            <span
                              className={cn(
                                'hidden rounded-full px-2 py-0.5 text-xs font-semibold sm:inline',
                                ACTION_STATUS_BADGE[a.status as ActionStatusValue],
                              )}
                            >
                              {actionStatusLabel(a.status)}
                            </span>
                          </>
                        }
                      >
                        <span className="block truncate font-medium text-brand-700">{a.title}</span>
                      </RowLink>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
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

function Rate({ label, n, total }: { label: string; n: number; total: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-ink">{pct(n, total)}%</dd>
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
        tone === 'muted' && 'border border-line bg-surface-sunken text-ink-muted',
      )}
    >
      {label}
    </span>
  );
}
