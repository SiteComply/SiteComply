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
 * The output is a balanced, strengths-first executive narrative for directors and
 * clients, carrying five sections in this order:
 *   headline · executiveSummary · positiveObservations · keyRisks ·
 *   recommendedActions · priorityFocus.
 */

export interface SummaryOutput {
  /** One-line verdict used as the panel title. */
  headline: string;
  /** 2–3 sentence executive overview, opening on strengths. */
  executiveSummary: string;
  /** Genuine strengths and achievements evident in the data — presented first. */
  positiveObservations: string[];
  /** Top risks / compliance gaps, most serious first. */
  keyRisks: string[];
  /** Concrete, practical next actions. */
  recommendedActions: string[];
  /** Ranked focus areas — where to concentrate effort now. */
  priorityFocus: string[];
}

/**
 * JSON schema passed to the provider for structured output. Property order mirrors
 * the strengths-first narrative (positiveObservations before keyRisks).
 */
export const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    executiveSummary: { type: 'string' },
    positiveObservations: { type: 'array', items: { type: 'string' } },
    keyRisks: { type: 'array', items: { type: 'string' } },
    recommendedActions: { type: 'array', items: { type: 'string' } },
    priorityFocus: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'headline',
    'executiveSummary',
    'positiveObservations',
    'keyRisks',
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
  'writing an executive briefing for directors and clients who need the picture in seconds.',
  '',
  'Use ONLY the figures in the provided JSON context. Never invent or estimate numbers, sites,',
  'names, dates or facts. Where a metric is zero, empty or missing, say so plainly rather than',
  'guessing or padding. Factual accuracy and grounding in the data come first, always.',
  '',
  'Tone: balanced, confident and executive, suitable for directors and clients. LEAD WITH',
  'STRENGTHS AND ACHIEVEMENTS, then cover risks, recommendations and focus areas. When the data',
  'shows strong or on-target performance, open on that positive footing — do NOT lead with a',
  'caution or a negative. Open with a concern ONLY when a genuinely critical issue exists (for',
  'example a critical audit finding, an overdue critical action, or a compliance rate far below',
  'target) that demands immediate attention. Never manufacture praise and never hide a real',
  'problem: state genuine risks plainly — just not ahead of the achievements unless critical.',
  'Be concise: quantify with the figures given and cut filler, hedging and repetition. Use plain',
  'British English. Include no personal data. Give no legal or medical advice.',
  '',
  'Return ONLY JSON matching the required schema (fields listed in narrative order):',
  '- headline: a one-line verdict on the overall position (about 6–12 words, no trailing full stop). Frame it on the strengths when performance is strong; make it cautionary only if a genuinely critical issue exists.',
  '- executiveSummary: 2–3 sentences. Open with the headline achievements and overall strength of performance, then note the single most important issue or next step. Ground every claim in a figure from the context. Lead with a concern only if it is genuinely critical.',
  '- positiveObservations: up to 4 short, genuine strengths or achievements evident in the data (strong or improving rates, targets met, well-covered areas); [] only if the data genuinely shows none — never manufacture a positive.',
  '- keyRisks: up to 5 short, specific risks or compliance gaps evident in the data, most serious first; [] if none are evident.',
  '- recommendedActions: up to 5 short, concrete actions a manager could take next, each starting with an action verb; [] if none are warranted.',
  '- priorityFocus: 1–3 ranked focus areas (most important first) naming where to concentrate effort now.',
  '',
  'Keep every bullet under about 20 words. Within each list, order by importance, not by the order the data appears.',
].join('\n');

/**
 * Short, target-specific guidance appended to the user prompt so each report type
 * is summarised on the dimensions that matter for it. Keyed by AiSummaryTarget.
 */
export const SUMMARY_TARGET_GUIDANCE: Record<string, string> = {
  COMPLIANCE_REPORT:
    'Lead with strong induction/acknowledgement completion and high PPE, site-rules, safe-working and GDPR-consent rates, then flag any site materially below the group compliance rate.',
  SCORECARD_REPORT:
    'Lead with the best-performing sites and the highest compliance and induction rates, then compare against weaker sites and any with low active-worker or contractor coverage.',
  ORG_OVERVIEW_REPORT:
    'Give a board-level read: open with organisation-wide strengths (compliance and induction rates, a positive attendance trend), then note contractor concentration and the spread between best- and worst-performing sites.',
  AUDIT:
    'Open with the audit outcome, overall score and what passed well, then cover the balance of finding severities, any open or overdue findings, and whether corrective actions are recorded. Treat open critical or high-severity findings as genuinely critical.',
  AUDITS_REGISTER:
    'Give a programme-level view: lead with audit coverage, sign-off progress and strong average scores, then note any sites or scores lagging behind.',
  ACTIONS_REGISTER:
    'Open with progress made (actions closed or on track), then cover the open and overdue backlog and its split by priority. Treat overdue high- and critical-priority actions as genuinely critical.',
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
    positiveObservations: strArr(o.positiveObservations),
    keyRisks: strArr(o.keyRisks),
    recommendedActions: strArr(o.recommendedActions),
    priorityFocus: strArr(o.priorityFocus),
  };
}
