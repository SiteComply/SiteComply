/**
 * Pure audit scoring maths (SC-014). Client-safe: no Prisma, no server imports.
 *
 * IMPORTANT: the Audit Scoring screen's LIVE PREVIEW and the server-side
 * calculation both import this module. That is deliberate — if the preview had
 * its own copy of the arithmetic the two would drift and the preview would lie
 * about how an audit is going to score. Every rule below is defined once, here.
 */

import {
  ITEM_POINTS_MAX,
  ITEM_POINTS_MIN,
  SECTION_NAME_MAX,
  TOTAL_SCORE_MAX,
  TOTAL_SCORE_MIN,
  WEIGHT_TOTAL,
  type ItemResultValue,
  type QuestionScoringRuleValue,
  type ScoringMethodValue,
} from './scoringConstants';

export interface ScoringConfig {
  method: ScoringMethodValue;
  totalPossibleScore: number;
  passingScore: number;
  showAsPercentage: boolean;
  roundScores: boolean;
}

export interface ScoringItem {
  id: string;
  sectionId: string | null;
  scoringRule: QuestionScoringRuleValue;
  points: number;
  mandatory: boolean;
  result: ItemResultValue | null;
}

export interface ScoringSection {
  id: string;
  name: string;
  weightPercent: number;
  order: number;
}

export interface SectionScore {
  sectionId: string;
  name: string;
  weightPercent: number;
  /** Points this section contributes when everything scorable passes. */
  availablePoints: number;
  earnedPoints: number;
  /** Items that count toward the score (INFO_ONLY and NA excluded). */
  scorableItems: number;
  answeredItems: number;
}

export interface ScoreResult {
  availablePoints: number;
  earnedPoints: number;
  /** 0–100. Null when nothing is scorable yet (avoids a misleading 0%). */
  percent: number | null;
  passed: boolean;
  /** Items flagged mandatory that were answered FAIL — these force a fail. */
  mandatoryFailureIds: string[];
  bySection: SectionScore[];
  /** True once every scorable item has an answer. */
  complete: boolean;
}

/** Section's slice of the total: weightPercent% of totalPossibleScore. */
export function sectionAvailablePoints(
  weightPercent: number,
  totalPossibleScore: number,
): number {
  return (clampWeight(weightPercent) / WEIGHT_TOTAL) * totalPossibleScore;
}

/**
 * Whether an item participates in scoring at all. INFO_ONLY never does; an item
 * answered NA is excluded from the denominator so it cannot penalise the score.
 */
export function isScorable(item: ScoringItem): boolean {
  if (item.scoringRule === 'INFO_ONLY') return false;
  if (item.result === 'NA') return false;
  return true;
}

/**
 * Score one section. Item `points` are RELATIVE weights within the section: the
 * section's own point pot is divided in proportion to them, so editing a
 * section's weight rescales its items automatically and the audit total always
 * reconciles to totalPossibleScore.
 */
export function scoreSection(
  section: ScoringSection,
  items: ScoringItem[],
  totalPossibleScore: number,
): SectionScore {
  const available = sectionAvailablePoints(
    section.weightPercent,
    totalPossibleScore,
  );
  const scorable = items.filter(isScorable);
  const weightSum = scorable.reduce((sum, i) => sum + Math.max(0, i.points), 0);

  let earned = 0;
  if (weightSum > 0) {
    for (const item of scorable) {
      if (item.result !== 'PASS') continue;
      // WEIGHTED and PASS_FAIL award identically once answered — the difference
      // is authoring intent (PASS_FAIL items are simply not given varying
      // points), so a single proportional rule covers both.
      earned += (Math.max(0, item.points) / weightSum) * available;
    }
  }

  return {
    sectionId: section.id,
    name: section.name,
    weightPercent: clampWeight(section.weightPercent),
    availablePoints: available,
    earnedPoints: earned,
    scorableItems: scorable.length,
    answeredItems: scorable.filter((i) => i.result !== null).length,
  };
}

/**
 * Score a whole audit. Handles the mandatory gate: ANY mandatory item answered
 * FAIL fails the audit outright, whatever the percentage — per the SC-014
 * requirement that such questions "must be passed regardless of the overall
 * score". Mandatory items still contribute their points normally.
 */
export function scoreAudit(
  config: ScoringConfig,
  sections: ScoringSection[],
  items: ScoringItem[],
): ScoreResult {
  const bySection = sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) =>
      scoreSection(
        section,
        items.filter((i) => i.sectionId === section.id),
        config.totalPossibleScore,
      ),
    );

  // Items with no section still count — grouped into an implicit bucket so an
  // SC-013 audit (which has no sections) can be scored without migration.
  const ungrouped = items.filter(
    (i) => i.sectionId === null || !sections.some((s) => s.id === i.sectionId),
  );
  if (ungrouped.length > 0) {
    const usedWeight = sections.reduce(
      (sum, s) => sum + clampWeight(s.weightPercent),
      0,
    );
    const remaining = Math.max(0, WEIGHT_TOTAL - usedWeight);
    bySection.push(
      scoreSection(
        {
          id: '__ungrouped__',
          name: 'Ungrouped',
          weightPercent: remaining,
          order: sections.length,
        },
        ungrouped,
        config.totalPossibleScore,
      ),
    );
  }

  const availablePoints = bySection.reduce(
    (sum, s) => sum + (s.scorableItems > 0 ? s.availablePoints : 0),
    0,
  );
  const earnedPoints = bySection.reduce((sum, s) => sum + s.earnedPoints, 0);

  const mandatoryFailureIds = items
    .filter((i) => i.mandatory && i.result === 'FAIL')
    .map((i) => i.id);

  const percent =
    availablePoints > 0 ? (earnedPoints / availablePoints) * 100 : null;

  const scorable = items.filter(isScorable);
  const complete =
    scorable.length > 0 && scorable.every((i) => i.result !== null);

  return {
    availablePoints: round(availablePoints, config.roundScores),
    earnedPoints: round(earnedPoints, config.roundScores),
    percent: percent === null ? null : round(percent, config.roundScores),
    passed: didPass(config, earnedPoints, percent, mandatoryFailureIds),
    mandatoryFailureIds,
    bySection: bySection.map((s) => ({
      ...s,
      availablePoints: round(s.availablePoints, config.roundScores),
      earnedPoints: round(s.earnedPoints, config.roundScores),
    })),
    complete,
  };
}

function didPass(
  config: ScoringConfig,
  earnedPoints: number,
  percent: number | null,
  mandatoryFailureIds: string[],
): boolean {
  // The mandatory gate overrides everything, including a 100% score.
  if (mandatoryFailureIds.length > 0) return false;
  if (percent === null) return false;
  if (config.method === 'PASS_FAIL') {
    // Every scorable item must pass; any FAIL already pulled percent below 100.
    return percent >= 100;
  }
  return earnedPoints >= config.passingScore;
}

function round(value: number, enabled: boolean): number {
  return enabled ? Math.round(value) : Math.round(value * 100) / 100;
}

function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0;
  return Math.min(WEIGHT_TOTAL, Math.max(0, weight));
}

// ---------------------------------------------------------------------------
// Validation — shared by the config screen (inline errors) and the API route.
// ---------------------------------------------------------------------------

export interface ConfigIssues {
  totalPossibleScore?: string;
  passingScore?: string;
  weights?: string;
  items?: string;
  /**
   * Per-section problems keyed by section id, so the config screen can mark the
   * offending ROW rather than showing an unattributed banner. Only present when
   * at least one section has a problem — an empty object would make hasIssues()
   * report a problem that isn't there.
   */
  sections?: Record<string, string>;
}

/**
 * Validate one section's name. Shared so the screen, the shared validator and the
 * API's error message all describe the rule identically.
 */
export function sectionNameIssue(name: string): string | null {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Enter a section name.';
  if (trimmed.length > SECTION_NAME_MAX) {
    return `Section name must be ${SECTION_NAME_MAX} characters or fewer.`;
  }
  return null;
}

/** Human label for a section in an error message: its name, else its position. */
export function sectionLabel(section: ScoringSection, index: number): string {
  const trimmed = (section.name ?? '').trim();
  return trimmed ? `"${trimmed}"` : `Section ${index + 1}`;
}

export function weightTotal(sections: ScoringSection[]): number {
  return sections.reduce((sum, s) => sum + clampWeight(s.weightPercent), 0);
}

export function validateScoringConfig(
  config: ScoringConfig,
  sections: ScoringSection[],
  items: ScoringItem[],
): ConfigIssues {
  const issues: ConfigIssues = {};

  if (
    !Number.isInteger(config.totalPossibleScore) ||
    config.totalPossibleScore < TOTAL_SCORE_MIN ||
    config.totalPossibleScore > TOTAL_SCORE_MAX
  ) {
    issues.totalPossibleScore = `Total possible score must be between ${TOTAL_SCORE_MIN} and ${TOTAL_SCORE_MAX}.`;
  }

  if (
    !Number.isInteger(config.passingScore) ||
    config.passingScore < 0 ||
    config.passingScore > config.totalPossibleScore
  ) {
    issues.passingScore =
      'Passing score must be between 0 and the total possible score.';
  }

  if (sections.length > 0) {
    const total = weightTotal(sections);
    if (Math.round(total) !== WEIGHT_TOTAL) {
      issues.weights = `Section weights must total ${WEIGHT_TOTAL}% — currently ${Math.round(total)}%.`;
    }
  }

  // Section names live HERE, in the shared validator, so the screen can block
  // Save on exactly the same rule the API enforces. Keeping this server-only was
  // the SC-014 defect: Save looked enabled and failed after a round-trip.
  const sectionIssues: Record<string, string> = {};
  for (const section of sections) {
    const issue = sectionNameIssue(section.name);
    if (issue) sectionIssues[section.id] = issue;
  }
  if (Object.keys(sectionIssues).length > 0) {
    issues.sections = sectionIssues;
  }

  const badPoints = items.some(
    (i) =>
      !Number.isInteger(i.points) ||
      i.points < ITEM_POINTS_MIN ||
      i.points > ITEM_POINTS_MAX,
  );
  if (badPoints) {
    issues.items = `Question points must be whole numbers between ${ITEM_POINTS_MIN} and ${ITEM_POINTS_MAX}.`;
  }

  return issues;
}

export function hasIssues(issues: ConfigIssues): boolean {
  return Object.keys(issues).length > 0;
}
