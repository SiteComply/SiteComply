import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { ActionStatusControl } from '@/components/platform/ActionStatusControl';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  getActionForViewer,
  listActionActivities,
} from '@/services/actions/actionService';
import { listActionEvidence } from '@/services/actions/actionEvidenceService';
import { listFindingEvidence } from '@/services/audits/findingEvidenceService';
import { ActionDeleteButton } from '@/components/platform/ActionDeleteButton';
import { ActionEvidencePanel } from '@/components/platform/ActionEvidencePanel';
import { EvidenceGallery } from '@/components/platform/EvidenceGallery';
import {
  ActionTimeline,
  type ActivityRow,
} from '@/components/platform/ActionTimeline';
import {
  actionPriorityLabel,
  actionStatusLabel,
  ACTION_PRIORITY_BADGE,
  ACTION_STATUS_BADGE,
  ACTION_OVERDUE_BADGE,
  type ActionPriorityValue,
  type ActionStatusValue,
} from '@/services/actions/actionConstants';
import { formatDateUK, formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Action detail — the full record, its status workflow and (if raised from an
 * audit) a link back to the originating finding/audit. Only reachable for
 * actions within the viewer's scope. Editing + status changes need "edit".
 */
export default async function ActionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'actions');

  const action = await getActionForViewer(viewer, params.id);
  if (!action) notFound();

  const canEdit = permits(viewer.role, 'actions', 'edit');
  const overdue =
    action.status !== 'COMPLETED' &&
    !!action.dueDate &&
    action.dueDate < new Date();

  const activities: ActivityRow[] = (await listActionActivities(action.id)).map(
    (a) => ({
      id: a.id,
      type: a.type,
      note: a.note,
      fromValue: a.fromValue,
      toValue: a.toValue,
      authorName: a.authorName,
      createdAt: a.createdAt.toISOString(),
    }),
  );

  const evidence = await listActionEvidence(action.id);
  // If this action was raised from a finding, surface that finding's evidence
  // (read-only) so the user has the original issue evidence. Gated by audits view.
  const findingEvidence =
    action.auditFinding && permits(viewer.role, 'audits', 'view')
      ? await listFindingEvidence(action.auditFinding.id)
      : [];

  return (
    <PlatformShell>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: 'Actions', href: '/platform/dashboard/actions' },
            { label: action.title },
          ]}
        />
        <Link href="/platform/dashboard/actions" className="text-sm font-semibold text-brand-700 hover:underline">
          ← Actions
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-ink">{action.title}</h1>
              <Badge className={ACTION_STATUS_BADGE[action.status as ActionStatusValue]}>
                {actionStatusLabel(action.status)}
              </Badge>
              {overdue && <Badge className={ACTION_OVERDUE_BADGE}>Overdue</Badge>}
            </div>
            <p className="text-ink-muted">{action.jobSite.name}</p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Link
                href={`/platform/dashboard/actions/${action.id}/edit`}
                className="rounded-xl border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Edit action
              </Link>
              <ActionDeleteButton actionId={action.id} title={action.title} />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {action.description && (
            <Section title="Description">
              <p className="whitespace-pre-line text-sm text-ink">{action.description}</p>
            </Section>
          )}
          {action.completionNote && (
            <Section title="Completion note">
              <p className="whitespace-pre-line text-sm text-ink">
                {action.completionNote}
              </p>
            </Section>
          )}
          {action.auditFinding && (
            <Section title="Raised from audit finding">
              <p className="text-sm text-ink">
                <Link
                  href={`/platform/dashboard/audits/${action.auditFinding.audit.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {action.auditFinding.title}
                </Link>{' '}
                <span className="text-ink-subtle">
                  · audit “{action.auditFinding.audit.title}”
                </span>
              </p>
              {findingEvidence.length > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <EvidenceGallery
                    basePath={`/api/platform/audit-findings/${action.auditFinding.id}/evidence`}
                    evidence={findingEvidence}
                    canManage={false}
                    label="Finding evidence"
                  />
                </div>
              )}
            </Section>
          )}

          <ActionEvidencePanel
            actionId={action.id}
            evidence={evidence}
            canManage={canEdit}
          />

          <ActionTimeline
            actionId={action.id}
            activities={activities}
            canComment={canEdit}
          />
        </div>

        <div className="space-y-6">
          <Section title="Summary">
            <dl className="space-y-3">
              <Detail label="Priority" value={actionPriorityLabel(action.priority)} badge={ACTION_PRIORITY_BADGE[action.priority as ActionPriorityValue]} />
              <Detail label="Status" value={actionStatusLabel(action.status)} />
              <Detail label="Due date" value={action.dueDate ? formatDateUK(action.dueDate) : '—'} />
              <Detail label="Assigned to" value={action.assignedTo ?? '—'} />
              <Detail label="Site" value={`${action.jobSite.name} · ${action.jobSite.jobReference}`} />
              <Detail label="Created by" value={action.createdByName ?? 'Unknown'} />
              <Detail label="Created" value={formatDateTimeUK(action.createdAt)} />
              {action.completedAt && (
                <Detail label="Completed" value={formatDateTimeUK(action.completedAt)} />
              )}
            </dl>
          </Section>

          {canEdit && (
            <Section title="Status workflow">
              <ActionStatusControl actionId={action.id} status={action.status} />
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
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">
        {badge ? (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
            {value}
          </span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}
