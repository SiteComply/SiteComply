import { AuditStatus, ItemResult, QuestionScoringRule } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  MAX_SCORE_BANDS,
  MAX_SECTIONS,
  isItemResult,
  isQuestionScoringRule,
  isScoringMethod,
  type ItemResultValue,
  type ScoringMethodValue,
} from '@/services/audits/scoringConstants';
import {
  hasIssues,
  scoreAudit,
  sectionLabel,
  sectionNameIssue,
  validateScoringConfig,
  type ScoringConfig,
  type ScoringItem,
  type ScoringSection,
  type ScoreResult,
} from '@/services/audits/scoringMath';

/**
 * Audit scoring (SC-014). Owns the scoring CONFIGURATION (method, section
 * weightings, per-question rules, score bands), the auditor's RESPONSES, and the
 * automatic recalculation that turns the two into a score.
 *
 * All arithmetic lives in scoringMath.ts, which the config screen also imports —
 * so the live preview and the stored score can never diverge.
 *
 * Guards: `audits:edit` plus site-scoping via the audit's jobSiteId, and a
 * SIGNED_OFF audit is frozen (rescoring a signed-off audit would invalidate the
 * sign-off, which is a sign-off-role act, not an edit).
 */

export type ScoringResultCode =
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'signed_off' | 'invalid';
      error?: string;
      issues?: Record<string, string>;
    };

export interface SectionInput {
  /** Omitted for a new section. */
  id?: string;
  name: string;
  weightPercent: number;
}

export interface ItemScoringInput {
  id: string;
  sectionId: string | null;
  scoringRule: string;
  points: number;
  mandatory: boolean;
}

export interface ScoreBandInput {
  label: string;
  minScore: number;
  maxScore: number;
  tone?: string;
}

export interface SaveScoringInput {
  scoringEnabled: boolean;
  scoringMethod: string;
  totalPossibleScore: number;
  passingScore: number;
  showAsPercentage: boolean;
  roundScores: boolean;
  sections: SectionInput[];
  items: ItemScoringInput[];
  scoreBands: ScoreBandInput[];
}

/** Load an audit with everything the scoring screen and calculation need. */
export async function getScoringForAudit(
  viewer: PlatformViewer,
  auditId: string,
) {
  if (viewer.siteIds.length === 0) return null;
  return prisma.audit.findFirst({
    where: { id: auditId, jobSiteId: { in: viewer.siteIds } },
    include: {
      jobSite: { select: { id: true, name: true } },
      sections: { orderBy: { order: 'asc' } },
      items: { orderBy: { order: 'asc' } },
      scoreBands: { orderBy: { order: 'asc' } },
    },
  });
}

type LoadedAudit = NonNullable<Awaited<ReturnType<typeof getScoringForAudit>>>;

/** Map DB rows onto the pure-maths shapes. Single conversion point. */
export function toScoringInputs(audit: LoadedAudit): {
  config: ScoringConfig;
  sections: ScoringSection[];
  items: ScoringItem[];
} {
  return {
    config: {
      method: audit.scoringMethod as ScoringMethodValue,
      totalPossibleScore: audit.totalPossibleScore,
      passingScore: audit.passingScore,
      showAsPercentage: audit.showAsPercentage,
      roundScores: audit.roundScores,
    },
    sections: audit.sections.map((s) => ({
      id: s.id,
      name: s.name,
      weightPercent: s.weightPercent,
      order: s.order,
    })),
    items: audit.items.map((i) => ({
      id: i.id,
      sectionId: i.sectionId,
      scoringRule: i.scoringRule as ScoringItem['scoringRule'],
      points: i.points,
      mandatory: i.mandatory,
      result: i.result as ItemResultValue | null,
    })),
  };
}

/** Compute the current score without persisting — used for previews and reports. */
export function computeScore(audit: LoadedAudit): ScoreResult {
  const { config, sections, items } = toScoringInputs(audit);
  return scoreAudit(config, sections, items);
}

/**
 * Recalculate and persist the audit's score. Called after any change to config,
 * item rules or responses, so `calculatedScore` is always in step with the data
 * rather than depending on someone remembering to press a button.
 */
export async function recalculateAudit(
  auditId: string,
): Promise<ScoreResult | null> {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      jobSite: { select: { id: true, name: true } },
      sections: { orderBy: { order: 'asc' } },
      items: { orderBy: { order: 'asc' } },
      scoreBands: { orderBy: { order: 'asc' } },
    },
  });
  if (!audit) return null;

  const result = computeScore(audit as LoadedAudit);
  await prisma.audit.update({
    where: { id: auditId },
    data: {
      calculatedScore: audit.scoringEnabled ? result.earnedPoints : null,
      calculatedPercent:
        audit.scoringEnabled && result.percent !== null
          ? Math.round(result.percent)
          : null,
      calculatedPassed: audit.scoringEnabled ? result.passed : null,
      scoredAt: audit.scoringEnabled ? new Date() : null,
    },
  });
  return result;
}

async function loadEditable(
  viewer: PlatformViewer,
  auditId: string,
): Promise<
  | { ok: true; audit: { id: string; status: AuditStatus } }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'signed_off' }
> {
  if (!permits(viewer.role, 'audits', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (viewer.siteIds.length === 0) return { ok: false, reason: 'not_found' };
  const audit = await prisma.audit.findFirst({
    where: { id: auditId, jobSiteId: { in: viewer.siteIds } },
    select: { id: true, status: true },
  });
  if (!audit) return { ok: false, reason: 'not_found' };
  if (audit.status === AuditStatus.SIGNED_OFF) {
    return { ok: false, reason: 'signed_off' };
  }
  return { ok: true, audit };
}

/**
 * Persist the whole scoring configuration in one transaction: config fields,
 * sections (create/update/delete), per-item rules and score bands. Validated with
 * the SAME validator the screen uses, so the API can never accept a configuration
 * the UI would have rejected (or vice versa).
 */
export async function saveScoringConfig(
  viewer: PlatformViewer,
  auditId: string,
  input: SaveScoringInput,
): Promise<ScoringResultCode> {
  const editable = await loadEditable(viewer, auditId);
  if (!editable.ok) return { ok: false, reason: editable.reason };

  if (!isScoringMethod(input.scoringMethod)) {
    return { ok: false, reason: 'invalid', error: 'Unknown scoring method.' };
  }
  if (input.sections.length > MAX_SECTIONS) {
    return {
      ok: false,
      reason: 'invalid',
      error: `A maximum of ${MAX_SECTIONS} sections is allowed.`,
    };
  }
  if (input.scoreBands.length > MAX_SCORE_BANDS) {
    return {
      ok: false,
      reason: 'invalid',
      error: `A maximum of ${MAX_SCORE_BANDS} score bands is allowed.`,
    };
  }
  // Section names are validated by the SHARED validator below (alongside weights
  // and points) so the screen and the API agree; this loop only turns the first
  // failure into a message that names the offending section.
  for (const [idx, section] of input.sections.entries()) {
    const issue = sectionNameIssue(section.name);
    if (issue) {
      return {
        ok: false,
        reason: 'invalid',
        error: `${sectionLabel({ id: section.id ?? `new-${idx}`, name: section.name, weightPercent: section.weightPercent, order: idx }, idx)}: ${issue}`,
      };
    }
  }
  for (const item of input.items) {
    if (!isQuestionScoringRule(item.scoringRule)) {
      return {
        ok: false,
        reason: 'invalid',
        error: 'Unknown question scoring rule.',
      };
    }
  }
  if (input.scoringMethod === 'CUSTOM') {
    for (const band of input.scoreBands) {
      if (!band.label.trim()) {
        return {
          ok: false,
          reason: 'invalid',
          error: 'Every score band needs a label.',
        };
      }
      if (band.minScore > band.maxScore) {
        return {
          ok: false,
          reason: 'invalid',
          error: `Score band "${band.label}" has a minimum above its maximum.`,
        };
      }
    }
  }

  // Only items that actually belong to this audit may be touched.
  const owned = await prisma.auditItem.findMany({
    where: { auditId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((i) => i.id));
  if (input.items.some((i) => !ownedIds.has(i.id))) {
    return { ok: false, reason: 'invalid', error: 'Unknown checklist item.' };
  }

  // Validate with the shared validator (weights totalling 100, ranges, points).
  const issues = validateScoringConfig(
    {
      method: input.scoringMethod as ScoringMethodValue,
      totalPossibleScore: input.totalPossibleScore,
      passingScore: input.passingScore,
      showAsPercentage: input.showAsPercentage,
      roundScores: input.roundScores,
    },
    input.sections.map((s, idx) => ({
      id: s.id ?? `new-${idx}`,
      name: s.name,
      weightPercent: s.weightPercent,
      order: idx,
    })),
    input.items.map((i) => ({
      id: i.id,
      sectionId: i.sectionId,
      scoringRule: i.scoringRule as ScoringItem['scoringRule'],
      points: i.points,
      mandatory: i.mandatory,
      result: null,
    })),
  );
  if (hasIssues(issues)) {
    return {
      ok: false,
      reason: 'invalid',
      error:
        (issues.sections ? Object.values(issues.sections)[0] : undefined) ??
        issues.weights ??
        issues.totalPossibleScore ??
        issues.passingScore ??
        issues.items,
      issues: issues as Record<string, string>,
    };
  }

  await prisma.$transaction(async (tx) => {
    // Sections: update in place, create new, delete the ones that went away.
    const existing = await tx.auditSection.findMany({
      where: { auditId },
      select: { id: true },
    });
    const keptIds = new Set(
      input.sections.map((s) => s.id).filter((id): id is string => !!id),
    );
    const removed = existing.filter((s) => !keptIds.has(s.id)).map((s) => s.id);

    const idByIndex: (string | undefined)[] = [];
    for (const [idx, section] of input.sections.entries()) {
      if (section.id && existing.some((e) => e.id === section.id)) {
        await tx.auditSection.update({
          where: { id: section.id },
          data: {
            name: section.name.trim(),
            weightPercent: section.weightPercent,
            order: idx,
          },
        });
        idByIndex[idx] = section.id;
      } else {
        const created = await tx.auditSection.create({
          data: {
            auditId,
            name: section.name.trim(),
            weightPercent: section.weightPercent,
            order: idx,
          },
          select: { id: true },
        });
        idByIndex[idx] = created.id;
      }
    }

    // Items reference sections by their POSITION when the section is new, so the
    // client doesn't need to know server-generated ids before saving.
    for (const item of input.items) {
      let sectionId: string | null = item.sectionId;
      if (sectionId && sectionId.startsWith('new-')) {
        const idx = Number(sectionId.slice('new-'.length));
        sectionId = idByIndex[idx] ?? null;
      }
      await tx.auditItem.update({
        where: { id: item.id },
        data: {
          sectionId,
          scoringRule: item.scoringRule as QuestionScoringRule,
          points: item.points,
          mandatory: item.mandatory,
        },
      });
    }

    if (removed.length > 0) {
      // Items on a removed section fall back to ungrouped (FK is SET NULL).
      await tx.auditSection.deleteMany({ where: { id: { in: removed } } });
    }

    await tx.auditScoreBand.deleteMany({ where: { auditId } });
    if (input.scoringMethod === 'CUSTOM' && input.scoreBands.length > 0) {
      await tx.auditScoreBand.createMany({
        data: input.scoreBands.map((b, idx) => ({
          auditId,
          label: b.label.trim(),
          minScore: b.minScore,
          maxScore: b.maxScore,
          tone: b.tone ?? 'brand',
          order: idx,
        })),
      });
    }

    await tx.audit.update({
      where: { id: auditId },
      data: {
        scoringEnabled: input.scoringEnabled,
        scoringMethod: input.scoringMethod as ScoringMethodValue,
        totalPossibleScore: input.totalPossibleScore,
        passingScore: input.passingScore,
        showAsPercentage: input.showAsPercentage,
        roundScores: input.roundScores,
      },
    });
  });

  await recalculateAudit(auditId);
  return { ok: true };
}

/**
 * Record the auditor's answer to one checklist item and recalculate. `result`
 * null clears the answer. Points awarded are derived, never client-supplied.
 */
export async function setItemResult(
  viewer: PlatformViewer,
  auditId: string,
  itemId: string,
  result: string | null,
  note?: string | null,
): Promise<ScoringResultCode> {
  const editable = await loadEditable(viewer, auditId);
  if (!editable.ok) return { ok: false, reason: editable.reason };

  if (result !== null && !isItemResult(result)) {
    return { ok: false, reason: 'invalid', error: 'Unknown result.' };
  }

  const item = await prisma.auditItem.findFirst({
    where: { id: itemId, auditId },
    select: { id: true, points: true, scoringRule: true },
  });
  if (!item) return { ok: false, reason: 'not_found' };

  // Derived server-side so a client can never award itself points.
  const pointsAwarded =
    result === 'PASS' && item.scoringRule !== QuestionScoringRule.INFO_ONLY
      ? item.points
      : result === null
        ? null
        : 0;

  await prisma.auditItem.update({
    where: { id: itemId },
    data: {
      result: result === null ? null : (result as ItemResult),
      pointsAwarded,
      answeredAt: result === null ? null : new Date(),
      answeredByName: result === null ? null : viewer.name,
      ...(note === undefined ? {} : { note: note?.trim() || null }),
    },
  });

  await recalculateAudit(auditId);
  return { ok: true };
}
