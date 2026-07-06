/**
 * Prompt templates + structured-output schema for AI Summaries (Phase 1b).
 *
 * One shared system prompt establishes the analyst role, the "use only the
 * provided data" guardrail and the JSON output contract. Per-target user prompts
 * are just a short instruction plus the PII-safe context JSON built by the
 * context builders. Versioned via AI_SUMMARY_PROMPT_VERSION (logged per summary).
 */

export interface SummaryOutput {
  headline: string;
  keyPoints: string[];
  risks: string[];
  recommendedFocus: string[];
}

/** JSON schema passed to the provider for structured output. */
export const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    recommendedFocus: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'keyPoints', 'risks', 'recommendedFocus'],
};

export const SUMMARY_MAX_OUTPUT_TOKENS = 700;

export const SUMMARY_SYSTEM_PROMPT = [
  'You are a SiteComply compliance analyst for UK construction health & safety.',
  'Write a concise executive summary using ONLY the metrics in the provided JSON context.',
  'Never invent numbers, sites, names or facts. If the data is empty or a metric is missing, say so plainly.',
  'Use British English and a clear executive tone. Do not include any personal data.',
  'Do not give legal or medical advice.',
  'Return ONLY JSON matching the required schema:',
  '- headline: one sentence capturing the overall picture.',
  '- keyPoints: 3–6 short factual bullet strings drawn from the metrics.',
  '- risks: 0–5 short bullet strings for concerns/gaps evident in the data.',
  '- recommendedFocus: 0–5 short, practical suggested focus areas.',
].join('\n');

/** Build the user prompt for a target from its label, scope description and context. */
export function buildUserPrompt(
  targetLabel: string,
  scopeLabel: string,
  context: unknown,
): string {
  return [
    `Produce an executive summary of this ${targetLabel} (${scopeLabel}).`,
    'Base it strictly on the following context.',
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
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const headline = typeof o.headline === 'string' ? o.headline : '';
  if (headline.trim() === '') return null;
  return {
    headline,
    keyPoints: strArr(o.keyPoints),
    risks: strArr(o.risks),
    recommendedFocus: strArr(o.recommendedFocus),
  };
}
