/**
 * Client-safe Audit Scoring constants (SC-014). Shared by the Audit Scoring
 * configuration screen, the scoring maths and the server-side service. No
 * Prisma/server imports — mirrors the auditTemplateConstants.ts pattern so the
 * config UI can import these directly.
 */

export type ScoringMethodValue = 'PERCENTAGE' | 'PASS_FAIL' | 'CUSTOM';
export type QuestionScoringRuleValue = 'WEIGHTED' | 'PASS_FAIL' | 'INFO_ONLY';
export type ItemResultValue = 'PASS' | 'FAIL' | 'NA';

/** Icon keys resolved by components/platform/icons.tsx — never raw SVG here. */
export type ScoringIconKey =
  | 'percent'
  | 'shield'
  | 'sliders'
  | 'weight'
  | 'check'
  | 'alert'
  | 'info';

export interface ScoringMethodOption {
  value: ScoringMethodValue;
  label: string;
  /** One line, shown under the label on the method card. */
  description: string;
  icon: ScoringIconKey;
}

/** The three method cards, in the order the REV-1 mockup presents them. */
export const SCORING_METHODS: ScoringMethodOption[] = [
  {
    value: 'PERCENTAGE',
    label: 'Percentage Score',
    description: 'Score based on total points achieved',
    icon: 'percent',
  },
  {
    value: 'PASS_FAIL',
    label: 'Pass / Fail',
    description: 'Audit is either passed or failed',
    icon: 'shield',
  },
  {
    value: 'CUSTOM',
    label: 'Custom Score',
    description: 'Define custom score ranges',
    icon: 'sliders',
  },
];

export interface QuestionRuleOption {
  value: QuestionScoringRuleValue | 'MANDATORY';
  label: string;
  description: string;
  icon: ScoringIconKey;
  /**
   * MANDATORY is presented as a fourth card to match the mockup, but it is NOT a
   * ScoringMethod member — it maps to the separate `mandatory` boolean on the
   * item, so a question can be both weighted and mandatory.
   */
  isFlag: boolean;
}

/** The 2x2 grid of question scoring rule cards. */
export const QUESTION_RULES: QuestionRuleOption[] = [
  {
    value: 'WEIGHTED',
    label: 'Weighted Questions',
    description: 'Assign points to questions based on importance',
    icon: 'weight',
    isFlag: false,
  },
  {
    value: 'PASS_FAIL',
    label: 'Pass / Fail Questions',
    description: 'Questions are either passed or failed',
    icon: 'check',
    isFlag: false,
  },
  {
    value: 'MANDATORY',
    label: 'Mandatory Questions',
    description: 'Must be answered and passed to pass the audit',
    icon: 'alert',
    isFlag: true,
  },
  {
    value: 'INFO_ONLY',
    label: 'Information Only',
    description: 'No score impact',
    icon: 'info',
    isFlag: false,
  },
];

// Validation limits.
export const SECTION_NAME_MAX = 120;
export const MAX_SECTIONS = 30;
export const MAX_SCORE_BANDS = 8;
export const TOTAL_SCORE_MIN = 1;
export const TOTAL_SCORE_MAX = 10000;
export const ITEM_POINTS_MIN = 0;
export const ITEM_POINTS_MAX = 1000;

/** Section weights must sum to exactly this (the mockup's "Total 100%" row). */
export const WEIGHT_TOTAL = 100;

export const SCORING_METHOD_LABEL: Record<ScoringMethodValue, string> =
  Object.fromEntries(SCORING_METHODS.map((m) => [m.value, m.label])) as Record<
    ScoringMethodValue,
    string
  >;

export function isScoringMethod(v: string): v is ScoringMethodValue {
  return SCORING_METHODS.some((m) => m.value === v);
}

export function isQuestionScoringRule(
  v: string,
): v is QuestionScoringRuleValue {
  return v === 'WEIGHTED' || v === 'PASS_FAIL' || v === 'INFO_ONLY';
}

export function isItemResult(v: string): v is ItemResultValue {
  return v === 'PASS' || v === 'FAIL' || v === 'NA';
}
