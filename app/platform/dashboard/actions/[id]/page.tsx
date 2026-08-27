import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { RecordHeader } from '@/components/platform/RecordHeader';
import { Panel } from '@/components/platform/Panel';
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
      <RecordHeader
        breadcrumbs={[
          { label: 'Actions', href: '/platform/dashboard/actions' },
          { label: action.title },
        ]}
        backHref="/platform/dashboard/actions"
        backLabel="Actions"
        title={action.title}
        badges={
          <>
            <Badge
              className={
                ACTION_STATUS_BADGE[action.status as ActionStatusValue]
              }
            >
              {actionStatusLabel(action.status)}
            </Badge>
            {overdue && <Badge className={ACTION_OVERDUE_BADGE}>Overdue</Badge>}
          </>
        }
        subtitle={action.jobSite.name}
        actions={
          canEdit && (
            <>
              <Link
                href={`/platform/dashboard/actions/${action.id}/edit`}
                className="rounded-xl border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Edit action
              </Link>
              <ActionDeleteButton actionId={action.id} title={action.title} />
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ONE panel for what this action IS, rather than a titled card each
              for description, completion note and origin. Three boxes stacked
              down the page made the reader work out that they were all facets of
              the same record; separated by rules inside one surface, they read
              as one thing — which is the Phase 3 lesson about framing for
              framing's sake, applied to a record instead of a settings page. */}
          <Panel title="Action detail">
            {action.description && (
              <p className="whitespace-pre-line text-sm text-ink">
                {action.description}
              </p>
            )}

            {action.auditFinding && (
              <div
                className={
                  action.description
                    ? 'mt-4 border-t border-line pt-4'
                    : undefined
                }
              >
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Raised from audit finding
                </p>
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
                  <div className="mt-3">
                    <EvidenceGallery
                      basePath={`/api/platform/audit-findings/${action.auditFinding.id}/evidence`}
                      evidence={findingEvidence}
                      canManage={false}
                      label="Finding evidence"
                    />
                  </div>
                )}
              </div>
            )}

            {action.completionNote && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Completion note
                </p>
                <p className="whitespace-pre-line text-sm text-ink">
                  {action.completionNote}
                </p>
              </div>
            )}

            {/* Evidence is part of the record, not a neighbour of it. It was a
                panel of its own directly beneath this one, so a photograph of
                the thing being described sat outside the description. */}
            <div
              className={
                action.description ||
                action.completionNote ||
                action.auditFinding
                  ? 'mt-4 border-t border-line pt-4'
                  : undefined
              }
            >
              <ActionEvidencePanel
                actionId={action.id}
                evidence={evidence}
                canManage={canEdit}
              />
            </div>
          </Panel>

          <ActionTimeline
            actionId={action.id}
            activities={activities}
            canComment={canEdit}
          />
        </div>

        {/* Context rail. The status workflow used to be a second card below this
            one, which put the Status fact and the control that changes it in
            different boxes. They are the same subject, so they are now the same
            panel: read the state, then act on it. */}
        <div>
          {/* Sticky on the INNER div, not the grid item: a stretched grid item
              is as tall as the row, so a sticky rule on it has nowhere to
              travel and does nothing. The summary and the status control are
              what you reach for while reading down the activity thread. */}
          <div className="space-y-6 lg:sticky lg:top-6">
            <Panel title="Summary">
              <dl className="space-y-3">
                <Detail
                  label="Priority"
                  value={actionPriorityLabel(action.priority)}
                  badge={
                    ACTION_PRIORITY_BADGE[
                      action.priority as ActionPriorityValue
                    ]
                  }
                />
                <Detail
                  label="Status"
                  value={actionStatusLabel(action.status)}
                />
                <Detail
                  label="Due date"
                  value={action.dueDate ? formatDateUK(action.dueDate) : '—'}
                />
                <Detail
                  label="Assigned to"
                  value={
                    action.assignedTo
                      ? action.assignedToCompany
                        ? `${action.assignedTo} · ${action.assignedToCompany}`
                        : action.assignedTo
                      : '—'
                  }
                />
                <Detail
                  label="Site"
                  value={`${action.jobSite.name} · ${action.jobSite.jobReference}`}
                />
                <Detail
                  label="Created by"
                  value={action.createdByName ?? 'Unknown'}
                />
                <Detail
                  label="Created"
                  value={formatDateTimeUK(action.createdAt)}
                />
                {action.completedAt && (
                  <Detail
                    label="Completed"
                    value={formatDateTimeUK(action.completedAt)}
                  />
                )}
              </dl>

              {/* No heading on the divider below: ActionStatusControl prints its
                own "Update status" label, and two of them was exactly the kind
                of duplication this refactor is meant to remove. */}
              {canEdit && (
                <div className="mt-4 border-t border-line pt-4">
                  <ActionStatusControl
                    actionId={action.id}
                    status={action.status}
                  />
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}

function Detail({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-ink">
        {badge ? (
          <span
            className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}
          >
            {value}
          </span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Badge({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}
