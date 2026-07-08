/**
 * Prompt templates + structured-output schema for AI Summaries.
 *
 * One shared system prompt establishes the analyst role, the "use only the
 * provided data" guardrail and the executive JSON output contract. Per-target
 * user prompts add a short, target-specific focus instruction plus the PII-safe
 * context JSON built by the context builders. Versioned via
 * AI_SUMMARY_PROMPT_VERSION (logged with, and mixed into the cache key for, each
 * summary so a prompt change regenerates rather than serving a stale result).
 *
 * The output is written for senior leaders and always carries five sections:
 *   headline · executiveSummary · keyRisks · positiveObservations ·
 *   recommendedActions · priorityFocus.
 */

export interface SummaryOutput {
  /** One-line verdict used as the panel title. */
  headline: string;
  /** 2–3 sentence executive overview. */
  executiveSummary: string;
  /** Top risks / compliance gaps, most serious first. */
  keyRisks: string[];
  /** Genuine strengths evident in the data. */
  positiveObservations: string[];
  /** Concrete, practical next actions. */
  recommendedActions: string[];
  /** Ranked focus areas — where to concentrate effort now. */
  priorityFocus: string[];
}

/** JSON schema passed to the provider for structured output. */
export const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    executiveSummary: { type: 'string' },
    keyRisks: { type: 'array', items: { type: 'string' } },
    positiveObservations: { type: 'array', items: { type: 'string' } },
    recommendedActions: { type: 'array', items: { type: 'string' } },
    priorityFocus: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'headline',
    'executiveSummary',
    'keyRisks',
    'positiveObservations',
    'recommendedActions',
    'priorityFocus',
  ],
};

// Budget for the visible answer PLUS the hidden reasoning tokens the GPT-5 /
// o-series models spend before it. The executive JSON is ~300–400 tokens; the
// remainder is reasoning headroom so a summary is never truncated mid-output.
export const SUMMARY_MAX_OUTPUT_TOKENS = 2500;

export const SUMMARY_SYSTEM_PROMPT = [
  'You are a SiteComply compliance analyst for UK construction health, safety and compliance,',
  'writing for senior leaders (directors and project managers) who need the picture in seconds.',
  '',
  'Use ONLY the figures in the provided JSON context. Never invent or estimate numbers, sites,',
  'names, dates or facts. Where a metric is zero, empty or missing, say so plainly rather than',
  'guessing or padding the summary.',
  '',
  'Be concise and executive: lead with what matters most, quantify with the figures given, and cut',
  'filler, hedging and repetition. Use plain British English. Include no personal data. Give no',
  'legal or medical advice.',
  '',
  'Return ONLY JSON matching the required schema:',
  '- headline: a punchy one-line verdict on the overall position (about 6–12 words, no trailing full stop).',
  '- executiveSummary: 2–3 sentences on the overall picture and the single most important takeaway, each claim grounded in a figure from the context.',
  '- keyRisks: up to 5 short, specific risks or compliance gaps evident in the data, most serious first; [] if none are evident.',
  '- positiveObservations: up to 4 short, genuine strengths evident in the data (strong rates, improvements, well-covered areas); [] if none — never manufacture a positive.',
  '- recommendedActions: up to 5 short, concrete actions a manager could take next, each starting with an action verb; [] if none are warranted.',
  '- priorityFocus: 1–3 ranked focus areas (most important first) naming where to concentrate effort now.',
  '',
  'Keep every bullet under about 20 words. Order every list by importance, not by the order the data appears.',
].join('\n');

/**
 * Short, target-specific guidance appended to the user prompt so each report type
 * is summarised on the dimensions that matter for it. Keyed by AiSummaryTarget.
 */
export const SUMMARY_TARGET_GUIDANCE: Record<string, string> = {
  COMPLIANCE_REPORT:
    'Focus on induction and acknowledgement completion and the PPE, site-rules, safe-working and GDPR-consent rates. Name any site materially below the group compliance rate.',
  SCORECARD_REPORT:
    'Compare sites on compliance % and induction completion. Highlight the strongest and weakest performers and any site with low active-worker or contractor coverage.',
  ORG_OVERVIEW_REPORT:
    'Give a board-level read on organisation-wide compliance and induction rates, the direction of the attendance trend, contractor concentration, and the spread between best- and worst-performing sites.',
  AUDIT:
    'Summarise the audit outcome and overall score, the balance of finding severities, how many findings are open or overdue, and whether corrective actions are recorded. Flag any open critical or high-severity findings.',
  AUDITS_REGISTER:
    'Give a programme-level view of audit coverage and average score across sites, sign-off progress, and any sites or scores lagging behind.',
  ACTIONS_REGISTER:
    'Focus on the open and overdue backlog, the overdue split by priority, and the most urgent items. Emphasise overdue high- and critical-priority actions.',
};

/** Build the user prompt for a target from its type, label, scope and context. */
export function buildUserPrompt(
  targetType: string,
  targetLabel: string,
  scopeLabel: string,
  context: unknown,
): string {
  const guidance = SUMMARY_TARGET_GUIDANCE[targetType];
  return [
    `Produce an executive summary of this ${targetLabel} (${scopeLabel}).`,
    ...(guidance ? [guidance] : []),
    'Base every statement strictly on the context below. If it is empty, say there is nothing to report.',
    '',
    'Context (JSON):',
    JSON.stringify(context),
  ].join('\n');
}

/** Validate/normalise a model response into a SummaryOutput, or null if unusable. */
export function parseSummaryOutput(value: unknown): SummaryOutput | null {
  let obj = value;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : [];
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const headline = str(o.headline).trim();
  if (headline === '') return null;
  return {
    headline,
    executiveSummary: str(o.executiveSummary),
    keyRisks: strArr(o.keyRisks),
    positiveObservations: strArr(o.positiveObservations),
    recommendedActions: strArr(o.recommendedActions),
    priorityFocus: strArr(o.priorityFocus),
  };
}
