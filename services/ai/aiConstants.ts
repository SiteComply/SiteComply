/**
 * Client-safe AI Summaries constants (target values + labels). No Prisma/server
 * imports, so a future client surface and the server share one source of truth.
 * Values match the Prisma `AiSummaryTarget` enum exactly. Not yet used by any UI.
 */

export type AiSummaryTargetValue =
  | 'COMPLIANCE_REPORT'
  | 'SCORECARD_REPORT'
  | 'ORG_OVERVIEW_REPORT'
  | 'AUDIT'
  | 'AUDITS_REGISTER'
  | 'ACTIONS_REGISTER';

export const AI_SUMMARY_TARGETS: {
  value: AiSummaryTargetValue;
  label: string;
  /** true for register-level (roll-up) targets, false for per-item. */
  register: boolean;
}[] = [
  { value: 'COMPLIANCE_REPORT', label: 'Compliance report', register: false },
  { value: 'SCORECARD_REPORT', label: 'Site compliance scorecard', register: false },
  { value: 'ORG_OVERVIEW_REPORT', label: 'Organisation overview', register: false },
  { value: 'AUDIT', label: 'Audit', register: false },
  { value: 'AUDITS_REGISTER', label: 'Audits register', register: true },
  { value: 'ACTIONS_REGISTER', label: 'Actions register', register: true },
];

const LABELS = new Map(AI_SUMMARY_TARGETS.map((t) => [t.value, t.label]));

export const aiSummaryTargetLabel = (v: string) =>
  LABELS.get(v as AiSummaryTargetValue) ?? v;

export const isAiSummaryTarget = (v: string): v is AiSummaryTargetValue =>
  LABELS.has(v as AiSummaryTargetValue);

/** Current prompt/template version — logged with each generation for reproducibility
 *  and mixed into the summary cache key so a prompt change regenerates the result.
 *  v2: executive format (headline · executive summary · key risks · positive
 *  observations · recommended actions · priority focus) with per-report guidance. */
export const AI_SUMMARY_PROMPT_VERSION = 'v2';
