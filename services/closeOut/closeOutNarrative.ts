/**
 * SC-024 Phase 3 — AI narrative for a close-out pack.
 *
 * DELIBERATELY NOT the shared executive-summary shape. That one asks the model
 * for `keyRisks`, `recommendedActions` and `priorityFocus` — judgements, which
 * are exactly what must never appear in a handover document. A close-out pack is
 * given to a client as a record of what was captured; an AI sentence reading
 * "site compliance was satisfactory" would be a compliance conclusion nobody
 * signed off, sitting in a document that looks official.
 *
 * So this module asks only for descriptive prose, and then CHECKS the answer:
 * the prompt forbids verdict language and `findConclusionLanguage()` rejects it
 * if the model does it anyway. A prompt is guidance, not a guarantee.
 */

/** Bump when the prompt or schema changes; mixed into the cache key. */
export const CLOSE_OUT_PROMPT_VERSION = 'cop-v1';

/** Same reasoning-token headroom rationale as the executive summary. */
export const CLOSE_OUT_MAX_OUTPUT_TOKENS = 3000;

export interface CloseOutSectionNarrative {
  sectionId: string;
  narrative: string;
}

export interface CloseOutNarrative {
  /** A neutral, descriptive title — never a verdict on the project. */
  headline: string;
  /** Prose describing what the project involved and what this pack contains. */
  executiveSummary: string;
  /** One short descriptive paragraph per included section. */
  sectionNarratives: CloseOutSectionNarrative[];
}

export const CLOSE_OUT_NARRATIVE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    executiveSummary: { type: 'string' },
    sectionNarratives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sectionId: { type: 'string' },
          narrative: { type: 'string' },
        },
        required: ['sectionId', 'narrative'],
      },
    },
  },
  required: ['headline', 'executiveSummary', 'sectionNarratives'],
};

export const CLOSE_OUT_SYSTEM_PROMPT = [
  'You are writing descriptive narrative prose for the handover pack of a UK construction project.',
  'The pack is a RECORD of what was captured in SiteComply during the project. It is given to the',
  'client and the Principal Contractor.',
  '',
  'YOUR ROLE IS STRICTLY LIMITED TO DESCRIPTION. You describe what the records show. You do NOT',
  'evaluate, certify, approve, or conclude anything about compliance, safety or quality.',
  '',
  'You MUST NOT:',
  '- state or imply that the project, site or any party was compliant, non-compliant, safe, unsafe,',
  '  satisfactory, unsatisfactory, adequate, inadequate, acceptable or in breach of anything;',
  '- approve, certify, sign off, validate, endorse or clear any record, party or the project;',
  '- state that a legal, regulatory, CDM or contractual duty or standard was met or not met;',
  '- give an opinion, rating, verdict, assurance, recommendation, corrective action or next step;',
  '- assess performance, or characterise anything as good, poor, strong, weak, thorough or lacking;',
  '- speculate about anything not present in the JSON context, or invent numbers, names or dates.',
  '',
  'You MUST:',
  '- describe only what the context data shows, in neutral, factual, past-tense prose;',
  '- use the exact figures given, and say plainly when a count is zero or a section is empty;',
  '- write in plain British English, for a professional reader;',
  '- include no personal data: never name an individual worker, and give no phone numbers or addresses.',
  '',
  'Return ONLY JSON matching the required schema:',
  '- headline: a short neutral description of the project record (about 6-12 words, no trailing full stop).',
  '  It names what the pack covers. It is NOT a verdict — never "successful", "compliant" or "well managed".',
  '- executiveSummary: 3-5 sentences describing the project and what this pack contains, grounded in the',
  '  figures given. Purely descriptive: what was recorded, over what period, in what volume.',
  "- sectionNarratives: one entry per section in the context, each with that section's exact sectionId and a",
  '  1-3 sentence narrative describing what that section contains and what the records show. Use the counts',
  '  provided. If a section has no records, say so plainly. Do not judge what the records mean.',
  '',
  'Write about the RECORDS, not about the project\'s performance. "The pack contains 14 permit records issued',
  'between March and June" is right. "Permit control was well managed" is a judgement and is forbidden.',
].join('\n');

export function buildCloseOutUserPrompt(
  projectLabel: string,
  context: unknown,
): string {
  return [
    `Write the descriptive narrative for the close-out pack of ${projectLabel}.`,
    'Describe only what the records show. Do not evaluate, rate, approve or conclude anything.',
    'Produce one sectionNarratives entry for every section listed in the context, reusing its exact sectionId.',
    '',
    'Context (JSON):',
    JSON.stringify(context),
  ].join('\n');
}

/**
 * Verdict/approval language that must never reach a handover document.
 *
 * Word-boundary matched so ordinary prose survives: "complete" and "completion"
 * are perfectly normal here and must not trip "compliant". Each entry is a
 * phrase the model would only produce if it had started making a judgement.
 */
const CONCLUSION_PATTERNS: { label: string; re: RegExp }[] = [
  // "compliance" as a NOUN is ordinary vocabulary here — the pack has sections
  // called "Compliance certificates" and narratives routinely say "compliance
  // records". Only the adjective, and "in compliance with", are verdicts.
  {
    label: 'compliance verdict',
    re: /\b(?:non-?)?compliant\b|\bin\s+compliance\s+with\b|\bcompliance\s+(?:was|were|is)\b/i,
  },
  // Likewise "safe": "safe system of work", "safe working method statement" and
  // the seeded "Daily Safe Start" audit template are all legitimate. A verdict
  // is the copular form — "the site was safe".
  {
    label: 'safety verdict',
    re: /\bunsafe(?:ly)?\b|\b(?:was|were|is|are|remained|proved|deemed|appeared)\s+safe\b/i,
  },
  { label: 'adequacy verdict', re: /\b(?:in)?adequate(?:ly)?\b/i },
  { label: 'satisfaction verdict', re: /\b(?:un)?satisfactor(?:y|ily)\b/i },
  { label: 'acceptability verdict', re: /\b(?:un)?acceptabl[ey]\b/i },
  {
    label: 'approval',
    re: /\b(?:approved|approval|certif(?:ies|ied|ication)|signed off|sign-off)\b/i,
  },
  {
    label: 'endorsement',
    re: /\b(?:endorse[ds]?|validat(?:ed|es)|assur(?:ance|es|ed))\b/i,
  },
  {
    label: 'breach claim',
    re: /\b(?:breach(?:e[ds])?|violat(?:ion|ed|es)|contraven(?:ed|es|tion))\b/i,
  },
  {
    label: 'duty-met claim',
    re: /\b(?:duties|obligations|requirements|standards)\s+(?:were\s+)?(?:fully\s+)?(?:met|fulfilled|discharged)\b/i,
  },
  {
    label: 'performance judgement',
    re: /\b(?:well[- ]managed|poorly[- ]managed|robust|exemplary|thorough(?:ly)?|diligent(?:ly)?)\b/i,
  },
  { label: 'recommendation', re: /\b(?:we\s+)?recommend(?:s|ed|ation)?\b/i },
];

/**
 * The first piece of conclusion language in the text, or null when clean.
 * Returns the offending phrase so a rejection can say what was wrong rather
 * than failing silently.
 */
export function findConclusionLanguage(
  text: string,
): { label: string; match: string } | null {
  for (const { label, re } of CONCLUSION_PATTERNS) {
    const m = re.exec(text);
    if (m) return { label, match: m[0] };
  }
  return null;
}

/** Every string the model produced, for one pass of the guard. */
function narrativeText(n: CloseOutNarrative): string {
  return [
    n.headline,
    n.executiveSummary,
    ...n.sectionNarratives.map((s) => s.narrative),
  ].join('\n');
}

export type NarrativeParse =
  | { ok: true; narrative: CloseOutNarrative }
  | { ok: false; reason: string };

/**
 * Validate a model response into a CloseOutNarrative.
 *
 * Rejects rather than sanitises: quietly deleting a sentence would leave prose
 * that no longer reads correctly, and would hide that the model ignored its
 * instructions. A rejected generation is retried or omitted — the pack is
 * perfectly valid with no narrative at all.
 */
export function parseCloseOutNarrative(
  value: unknown,
  allowedSectionIds: string[],
): NarrativeParse {
  let obj = value;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return { ok: false, reason: 'Model did not return JSON.' };
    }
  }
  if (!obj || typeof obj !== 'object')
    return { ok: false, reason: 'Model returned an unusable response.' };

  const o = obj as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  const headline = str(o.headline);
  const executiveSummary = str(o.executiveSummary);
  if (headline === '' || executiveSummary === '')
    return { ok: false, reason: 'Model returned an empty narrative.' };

  const allowed = new Set(allowedSectionIds);
  const sectionNarratives: CloseOutSectionNarrative[] = [];
  if (Array.isArray(o.sectionNarratives)) {
    for (const raw of o.sectionNarratives) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const sectionId = str(r.sectionId);
      const narrative = str(r.narrative);
      // A narrative for a section the viewer never included would be prose about
      // data they could not see — drop it rather than render it.
      if (!allowed.has(sectionId) || narrative === '') continue;
      if (sectionNarratives.some((s) => s.sectionId === sectionId)) continue;
      sectionNarratives.push({ sectionId, narrative });
    }
  }

  const narrative = { headline, executiveSummary, sectionNarratives };
  const bad = findConclusionLanguage(narrativeText(narrative));
  if (bad)
    return {
      ok: false,
      reason: `Model produced ${bad.label} ("${bad.match}"), which is not permitted in a close-out pack.`,
    };

  return { ok: true, narrative };
}
