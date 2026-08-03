import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { RecordHeader } from '@/components/platform/RecordHeader';
import { AuditStatusControl } from '@/components/platform/AuditStatusControl';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  permits,
  canSignOffAudit,
} from '@/services/platformUsers/platformPermissions';
import { getAuditForViewer } from '@/services/audits/auditService';
import { canDeleteAudit } from '@/services/audits/auditConstants';
import { findingCategoryLabel } from '@/services/audits/findingConstants';
import { AuditDeleteButton } from '@/components/platform/AuditDeleteButton';
import { SaveAuditAsTemplateButton } from '@/components/platform/SaveAuditAsTemplateButton';
import { AuditChecklistPanel } from '@/components/platform/AuditChecklistPanel';
import { listFindingsForAudit } from '@/services/audits/findingService';
import { listEvidenceForFindings } from '@/services/audits/findingEvidenceService';
import {
  AuditFindingsPanel,
  type FindingRow,
} from '@/components/platform/AuditFindingsPanel';
import {
  auditStatusLabel,
  AUDIT_STATUS_BADGE,
  type AuditStatusValue,
} from '@/services/audits/auditConstants';
import { documentCategoryLabel } from '@/services/documents/documentConstants';
import { canUseAiSummaries } from '@/services/ai/aiConfig';
import { AiSummaryPanel } from '@/components/platform/AiSummaryPanel';
import { formatDateTimeUK } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

/**
 * Audit detail — the full record, its documents and status tracking / sign-off.
 * Only reachable for audits within the viewer's scope (site boundary enforced in
 * the service). Editing + status changes are shown to roles with "edit".
 */
export default async function AuditDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'audits');

  const audit = await getAuditForViewer(viewer, params.id);
  if (!audit) notFound();

  const canEdit = permits(viewer.role, 'audits', 'edit');
  const canCreate = permits(viewer.role, 'audits', 'create');
  const canDelete = canDeleteAudit(viewer.role);
  const canSignOff = canSignOffAudit(viewer.role);
  const canCreateAction = permits(viewer.role, 'actions', 'create');
  const showAiSummary = await canUseAiSummaries(viewer.role);
  const findings = await listFindingsForAudit(audit.id);
  const evidenceByFinding = await listEvidenceForFindings(
    findings.map((f) => f.id),
  );
  const findingRows: FindingRow[] = findings.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    category: f.category,
    severity: f.severity,
    status: f.status,
    dueDate: f.dueDate ? f.dueDate.toISOString() : null,
    correctiveAction: f.correctiveAction,
    createdByName: f.createdByName,
    evidence: evidenceByFinding[f.id] ?? [],
  }));

  return (
    <PlatformShell>
      <RecordHeader
        breadcrumbs={[
          { label: 'Audits', href: '/platform/dashboard/audits' },
          { label: audit.title },
        ]}
        backHref="/platform/dashboard/audits"
        backLabel="Audits"
        title={audit.title}
        badges={
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              AUDIT_STATUS_BADGE[audit.status as AuditStatusValue]
            }`}
          >
            {auditStatusLabel(audit.status)}
          </span>
        }
        subtitle={audit.jobSite.name}
        actions={
          <>
            {canEdit && (
              <Link
                href={`/platform/dashboard/audits/${audit.id}/edit`}
                className="rounded-xl border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Edit audit
              </Link>
            )}
            {canCreate && (
              <SaveAuditAsTemplateButton
                auditId={audit.id}
                defaultName={audit.title}
              />
            )}
            {canDelete && (
              <AuditDeleteButton auditId={audit.id} title={audit.title} />
            )}
          </>
        }
      />

      {showAiSummary && (
        <AiSummaryPanel targetType="AUDIT" targetKey={audit.id} />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {audit.description && (
            <Section title="Description">
              <p className="whitespace-pre-line text-sm text-ink">
                {audit.description}
              </p>
            </Section>
          )}
          {audit.observations && (
            <Section title="Observations">
              <p className="whitespace-pre-line text-sm text-ink">
                {audit.observations}
              </p>
            </Section>
          )}

          <Section title="Referenced documents">
            {audit.documents.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                No documents referenced.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {audit.documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="min-w-0">
                      <Link
                        href={`/platform/dashboard/documents/${d.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {d.title}
                      </Link>
                      <span className="block text-xs text-ink-subtle">
                        {documentCategoryLabel(d.category)} · {d.fileName}
                      </span>
                    </span>
                    <a
                      href={`/api/platform/documents/${d.id}/download`}
                      className="shrink-0 text-sm font-semibold text-brand-700 hover:underline"
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {audit.items.length > 0 && (
            <Section title={`Audit checklist (${audit.items.length})`}>
              {canEdit && audit.status !== 'SIGNED_OFF' && (
                <p className="mb-3 text-xs">
                  <Link
                    href={`/platform/dashboard/audits/${audit.id}/scoring`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    Configure scoring →
                  </Link>
                </p>
              )}
              <AuditChecklistPanel
                auditId={audit.id}
                scoringEnabled={audit.scoringEnabled}
                canEdit={canEdit && audit.status !== 'SIGNED_OFF'}
                items={audit.items.map((it) => ({
                  id: it.id,
                  label: it.label,
                  helpText: it.helpText,
                  categoryLabel: findingCategoryLabel(it.category),
                  sectionName:
                    audit.sections.find((s) => s.id === it.sectionId)?.name ??
                    null,
                  scoringRule: it.scoringRule,
                  points: it.points,
                  mandatory: it.mandatory,
                  result: it.result,
                  pointsAwarded: it.pointsAwarded,
                }))}
              />
            </Section>
          )}

          <AuditFindingsPanel
            auditId={audit.id}
            jobSiteId={audit.jobSite.id}
            findings={findingRows}
            canEdit={canEdit}
            canCreateAction={canCreateAction}
          />
        </div>

        <div className="space-y-6">
          <Section title="Summary">
            <dl className="space-y-3">
              {/* SC-014: when scoring is enabled the score is calculated from the
                  checklist; otherwise the legacy manually-entered score stands. */}
              {audit.scoringEnabled ? (
                <>
                  <Detail
                    label="Calculated score"
                    value={
                      audit.calculatedPercent === null
                        ? 'Not yet scored'
                        : audit.showAsPercentage
                          ? `${audit.calculatedPercent}%`
                          : `${audit.calculatedScore} / ${audit.totalPossibleScore} pts`
                    }
                  />
                  <Detail
                    label="Result"
                    value={
                      audit.calculatedPassed === null
                        ? '—'
                        : audit.calculatedPassed
                          ? 'Pass'
                          : 'Fail'
                    }
                  />
                  <Detail
                    label="Passing score"
                    value={`${audit.passingScore} / ${audit.totalPossibleScore} pts`}
                  />
                </>
              ) : (
                <Detail
                  label="Overall score"
                  value={
                    audit.overallScore === null ? '—' : `${audit.overallScore}%`
                  }
                />
              )}
              <Detail label="Status" value={auditStatusLabel(audit.status)} />
              <Detail
                label="Site"
                value={`${audit.jobSite.name} · ${audit.jobSite.jobReference}`}
              />
              <Detail
                label="Created by"
                value={audit.createdByName ?? 'Unknown'}
              />
              <Detail
                label="Created"
                value={formatDateTimeUK(audit.createdAt)}
              />
              {audit.sourceTemplateName && (
                <Detail
                  label="From template"
                  value={`${audit.sourceTemplateName} (v${audit.sourceTemplateVersion ?? 1})`}
                />
              )}
              {audit.signedOffAt && (
                <Detail
                  label={
                    audit.status === 'SIGNED_OFF'
                      ? 'Signed off'
                      : 'Last signed off'
                  }
                  value={`${audit.signedOffByName ?? 'Unknown'} · ${formatDateTimeUK(
                    audit.signedOffAt,
                  )}${audit.status === 'SIGNED_OFF' ? '' : ' · reopened since'}`}
                />
              )}
            </dl>
          </Section>

          {canEdit && (
            <Section title="Status tracking">
              <AuditStatusControl
                auditId={audit.id}
                status={audit.status}
                canSignOff={canSignOff}
              />
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
