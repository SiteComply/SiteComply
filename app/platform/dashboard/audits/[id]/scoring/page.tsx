import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getScoringForAudit } from '@/services/audits/auditScoringService';
import {
  AuditScoringConfig,
  type ScoringItemDraft,
  type ScoringSectionDraft,
} from '@/components/platform/AuditScoringConfig';
import type {
  QuestionScoringRuleValue,
  ScoringMethodValue,
} from '@/services/audits/scoringConstants';

export const dynamic = 'force-dynamic';

/**
 * SC-014 Audit Scoring configuration (REV-1 screenshot). Requires `audits:edit`
 * plus site scope; a signed-off audit is read-only, so we send the user back to
 * the audit rather than showing a screen whose Save can only fail.
 */
export default async function AuditScoringPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await requirePlatformViewer();
  if (!permits(viewer.role, 'audits', 'edit')) {
    redirect(`/platform/dashboard/audits/${params.id}`);
  }

  const audit = await getScoringForAudit(viewer, params.id);
  if (!audit) notFound();
  if (audit.status === 'SIGNED_OFF') {
    redirect(`/platform/dashboard/audits/${params.id}`);
  }

  const sections: ScoringSectionDraft[] = audit.sections.map((s) => ({
    id: s.id,
    name: s.name,
    weightPercent: s.weightPercent,
  }));

  const items: ScoringItemDraft[] = audit.items.map((i) => ({
    id: i.id,
    label: i.label,
    sectionId: i.sectionId,
    scoringRule: i.scoringRule as QuestionScoringRuleValue,
    points: i.points,
    mandatory: i.mandatory,
  }));

  return (
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Audits', href: '/platform/dashboard/audits' },
          {
            label: audit.title,
            href: `/platform/dashboard/audits/${audit.id}`,
          },
          { label: 'Scoring' },
        ]}
      />
      <AuditScoringConfig
        auditId={audit.id}
        auditTitle={audit.title}
        initial={{
          scoringEnabled: audit.scoringEnabled,
          scoringMethod: audit.scoringMethod as ScoringMethodValue,
          totalPossibleScore: audit.totalPossibleScore,
          passingScore: audit.passingScore,
          showAsPercentage: audit.showAsPercentage,
          roundScores: audit.roundScores,
          sections,
          items,
          scoreBands: audit.scoreBands.map((b) => ({
            label: b.label,
            minScore: b.minScore,
            maxScore: b.maxScore,
          })),
        }}
      />
    </PlatformShell>
  );
}
