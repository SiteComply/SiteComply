import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { RecordHeader } from '@/components/platform/RecordHeader';
import { Panel } from '@/components/platform/Panel';
import { PermitReviewControls } from '@/components/platform/PermitReviewControls';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import { getPermitForViewer } from '@/services/permits/permitAdminService';
import {
  permitStatusLabel,
  PERMIT_STATUS_BADGE,
} from '@/services/permits/permitConstants';
import { formatAnswer } from '@/services/permits/permitFlow';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/** Permit detail + review (SC-009). Scoped to the viewer's sites. */
export default async function PlatformPermitDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'permits');

  const detail = await getPermitForViewer(viewer, params.id);
  if (!detail) notFound();

  const {
    permit,
    effectiveStatus,
    siteName,
    workerName,
    workerCompany,
    answers,
    activities,
    canApprove,
  } = detail;

  return (
    <PlatformShell>
      <RecordHeader
        breadcrumbs={[
          { label: 'Permits', href: '/platform/dashboard/permits' },
          { label: permit.reference },
        ]}
        backHref="/platform/dashboard/permits"
        backLabel="Permits"
        title={permit.permitTypeName}
        badges={
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${PERMIT_STATUS_BADGE[effectiveStatus]}`}
          >
            {permitStatusLabel(effectiveStatus)}
          </span>
        }
        subtitle={<span className="font-mono">{permit.reference}</span>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column = what there is to READ before deciding: what was asked
            for, what was declared, and what has happened to the request so far.
            The "who / where / when" facts moved to the context rail, where the
            rest of the portal keeps them, so this column is no longer a mix of
            reference data and the thing the reviewer is here to do.

            The decision itself is in the rail, not here — see the note there. */}
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Requested work">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label="Work activity" value={permit.workActivity} wide />
              <Field label="Work location" value={permit.workLocation ?? '—'} />
            </dl>

            {answers.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Safety questions
                </p>
                <dl className="divide-y divide-line">
                  {answers.map((a) => (
                    <div
                      key={a.questionId}
                      className="flex justify-between gap-4 py-2.5"
                    >
                      <dt className="text-sm text-ink">{a.label}</dt>
                      <dd className="shrink-0 text-sm font-semibold text-ink">
                        {formatAnswer(a)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Panel>

          {/* The history belongs with the decision it records, and this is where
              the action detail screen already keeps it. In the rail it left the
              main column empty below the controls on an approved permit while
              the rail ran on past it. */}
          <Panel title="Activity">
            <ol className="space-y-3">
              {activities.map((ev) => (
                <li key={ev.id} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {ev.toValue ?? activityLabel(ev.type)}
                    </p>
                    {ev.note && (
                      <p className="text-sm text-ink-muted">{ev.note}</p>
                    )}
                    <p className="text-xs text-ink-subtle">
                      {formatDateTimeUK(ev.createdAt)}
                      {ev.authorName ? ` · ${ev.authorName}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div>
          {/* Sticky on the inner div — see the note on the action detail rail. */}
          <div className="space-y-6 lg:sticky lg:top-6">
            <Panel title="Summary">
              <dl className="space-y-3">
                <Field label="Worker" value={workerName} />
                <Field label="Company" value={workerCompany} />
                <Field label="Site" value={siteName} />
                {/* When it was raised was on the register but nowhere on the
                    record itself, so "how long has this been sitting with me?"
                    meant going back a screen to find out. */}
                <Field
                  label="Submitted"
                  value={formatDateTimeUK(permit.submittedAt)}
                />
                <Field
                  label="Proposed start"
                  value={
                    permit.proposedStart
                      ? formatDateTimeUK(permit.proposedStart)
                      : '—'
                  }
                />
                <Field
                  label="Proposed finish"
                  value={
                    permit.proposedFinish
                      ? formatDateTimeUK(permit.proposedFinish)
                      : '—'
                  }
                />
              </dl>
            </Panel>

            {/* The outcome callouts keep their own tint: on a permit, approved vs
              rejected is the single most important thing on the screen, and the
              colour is carrying that — so these stay distinct surfaces rather
              than being folded into Summary. Same colours as before. */}
            {(permit.status === 'APPROVED' || permit.validUntil) && (
              <Panel
                tone="flat"
                title={<span className="text-safe-700">Approval</span>}
                className="border border-safe-500/40 bg-safe-50 shadow-card"
              >
                <dl className="space-y-2">
                  <Field
                    label="Approved by"
                    value={permit.approvedByName ?? '—'}
                  />
                  <Field
                    label="Approved on"
                    value={
                      permit.approvedAt
                        ? formatDateTimeUK(permit.approvedAt)
                        : '—'
                    }
                  />
                  <Field
                    label="Valid from"
                    value={
                      permit.validFrom
                        ? formatDateTimeUK(permit.validFrom)
                        : '—'
                    }
                  />
                  <Field
                    label="Valid until"
                    value={
                      permit.validUntil
                        ? formatDateTimeUK(permit.validUntil)
                        : '—'
                    }
                  />
                </dl>
              </Panel>
            )}

            {permit.rejectionReason && (
              <Panel
                tone="flat"
                title={<span className="text-danger-600">Rejected</span>}
                className="border border-danger-500/40 bg-danger-50 shadow-card"
              >
                <p className="text-sm text-ink">{permit.rejectionReason}</p>
                <p className="mt-2 text-xs text-ink-subtle">
                  {permit.rejectedByName}
                  {permit.rejectedAt
                    ? ` · ${formatDateTimeUK(permit.rejectedAt)}`
                    : ''}
                </p>
              </Panel>
            )}

            {/* The decision belongs with the facts it is made against, and this
                is the pattern the action detail screen already uses: read the
                state in Summary, then act on it in the same rail. It also fixes
                a real imbalance — on a permit still awaiting a decision there is
                no outcome callout, so the rail was one short panel against a
                full-height main column, and the control the reviewer is here to
                use scrolled away with the declarations.

                Nothing was invented to fill the space: this panel already
                existed, it has simply moved, and it still renders only when the
                permit is actionable and only what this viewer may do. */}
            <PermitReviewControls
              permitId={permit.id}
              status={effectiveStatus}
              canApprove={canApprove}
            />
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}

/**
 * Events that move the permit carry a status label in `toValue`; a comment does
 * not, so the raw enum was being printed and every comment in the history read
 * as a shouted "COMMENT". Display-only fallback — the stored type is untouched.
 */
function activityLabel(type: string): string {
  const first = type.charAt(0) + type.slice(1).toLowerCase();
  return first.replace(/_/g, ' ');
}

function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}
