/**
 * Client-safe constants for AI Generated Knowledge Checks (SC-005).
 *
 * Kept free of Prisma / server imports (mirrors ../bulletins/bulletinConstants)
 * so the worker UI, the admin config UI and the server services share one source
 * of truth. String values match the Prisma enums exactly.
 */

export type KnowledgeQuestionCategoryValue =
  | 'SAFETY'
  | 'SITE_RULES'
  | 'EMERGENCY'
  | 'HAZARD'
  | 'GENERAL';

export const KNOWLEDGE_QUESTION_CATEGORIES: {
  value: KnowledgeQuestionCategoryValue;
  label: string;
}[] = [
  { value: 'SAFETY', label: 'Key safety information' },
  { value: 'SITE_RULES', label: 'Site rules' },
  { value: 'EMERGENCY', label: 'Emergency procedures' },
  { value: 'HAZARD', label: 'Significant hazards' },
  { value: 'GENERAL', label: 'General' },
];

const CATEGORY_LABELS = new Map(
  KNOWLEDGE_QUESTION_CATEGORIES.map((c) => [c.value, c.label]),
);

export function knowledgeQuestionCategoryLabel(value: string): string {
  return CATEGORY_LABELS.get(value as KnowledgeQuestionCategoryValue) ?? value;
}

export type InductionUnavailablePolicyValue = 'SKIP_FLAGGED' | 'BLOCK';

/**
 * Global defaults (the approved architecture). A per-site SiteInductionConfig row
 * overrides any of these; absence of a row means "use these values". These can be
 * shifted to env/DB later exactly as AiConfig does, but hard defaults keep the
 * feature safe and predictable before any configuration exists.
 */
export const KNOWLEDGE_CHECK_DEFAULTS = {
  /** Feature ships dark: off unless a site (or a future global toggle) enables it. */
  enabled: false,
  /** Questions shown per attempt (mockup: "Question 2 of 6"). */
  questionsPerAttempt: 6,
  /** Target size of the generated pool the attempt samples from. */
  poolTarget: 18,
  /** Minimum valid questions for a bank to be usable; below this → FAILED. */
  poolMinimum: 6,
  /** When no READY bank exists at check-in: never block the worker by default. */
  unavailablePolicy: 'SKIP_FLAGGED' as InductionUnavailablePolicyValue,
  /** Auto-publish generated banks unless a site opts into manager approval. */
  requireManagerApproval: false,
} as const;

/** Bounds for the per-site questions-per-attempt override. */
export const QUESTIONS_PER_ATTEMPT_MIN = 3;
export const QUESTIONS_PER_ATTEMPT_MAX = 12;

/**
 * Prompt/format version. Bumping it invalidates every cached bank (the version is
 * mixed into the content hash), so a prompt change regenerates rather than serves
 * questions written by the old template — same discipline as AI_SUMMARY_PROMPT_VERSION.
 */
export const KNOWLEDGE_CHECK_PROMPT_VERSION = 'v1';

/** Exactly four options per question (matches the worker UI + mockup). */
export const OPTIONS_PER_QUESTION = 4;

export function isUnavailablePolicy(
  v: string,
): v is InductionUnavailablePolicyValue {
  return v === 'SKIP_FLAGGED' || v === 'BLOCK';
}
