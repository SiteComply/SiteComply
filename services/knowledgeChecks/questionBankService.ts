import { createHash } from 'crypto';
import { KnowledgeQuestionCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveAiProvider } from '@/services/ai/aiConfigService';
import { getAiRuntimeConfig } from '@/services/ai/aiConfigService';
import { AiError } from '@/services/ai/AiProvider';
import { getCurrentChecklist } from '@/services/checklists/adminChecklistService';
import {
  KNOWLEDGE_CHECK_DEFAULTS,
  KNOWLEDGE_CHECK_PROMPT_VERSION,
  OPTIONS_PER_QUESTION,
} from '@/services/knowledgeChecks/knowledgeCheckConstants';

/**
 * AI question-bank generation for site inductions (SC-005).
 *
 * A bank is generated once per exact induction state — a (site, checklistVersion,
 * contentHash) triple, where the hash covers the checklist items AND the site's
 * free-text induction + emergency fields — and cached. Worker attempts sample
 * from the READY bank, so steady-state check-ins make no live model call; only
 * the first worker for a brand-new induction state (or a manual "Generate now")
 * incurs a generation, and a content change regenerates.
 *
 * The model is reached through the existing AiProvider abstraction (Azure OpenAI
 * in production; the deterministic mock locally/CI). Prompts carry NO worker PII
 * — only the site's own induction material.
 */

// ---------------------------------------------------------------------------
// Source corpus + content hash
// ---------------------------------------------------------------------------

interface InductionCorpus {
  siteName: string;
  jobReference: string;
  inductionContent: string;
  emergency: {
    fireAssemblyPoint: string | null;
    firstAiderName: string | null;
    firstAiderLocation: string | null;
    firstAiderNumber: string | null;
    nearestHospital: string | null;
    emergencyNumber: string | null;
  };
  // Site rules the worker confirms at induction. The internal item `type` is
  // deliberately NOT included: it is implementation metadata, not an induction
  // fact, and exposing it produced questions like "what type is this item?".
  checklistItems: { label: string; helpText: string | null }[];
}

export interface BankInduction {
  checklistVersion: number;
  corpus: InductionCorpus;
  contentHash: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

/**
 * Load the site's current induction corpus + a stable content hash. Returns null
 * only when the site has no checklist yet (nothing to generate from). The prompt
 * version is mixed into the hash so a prompt change regenerates the bank.
 */
export async function loadBankInduction(
  siteId: string,
): Promise<BankInduction | null> {
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: {
      name: true,
      jobReference: true,
      inductionContent: true,
      fireAssemblyPoint: true,
      firstAiderName: true,
      firstAiderLocation: true,
      firstAiderNumber: true,
      nearestHospital: true,
      emergencyNumber: true,
    },
  });
  if (!site) return null;

  const checklist = await getCurrentChecklist(siteId);
  if (!checklist) return null;

  const corpus: InductionCorpus = {
    siteName: site.name,
    jobReference: site.jobReference,
    inductionContent: site.inductionContent ?? '',
    emergency: {
      fireAssemblyPoint: site.fireAssemblyPoint,
      firstAiderName: site.firstAiderName,
      firstAiderLocation: site.firstAiderLocation,
      firstAiderNumber: site.firstAiderNumber,
      nearestHospital: site.nearestHospital,
      emergencyNumber: site.emergencyNumber,
    },
    checklistItems: checklist.items.map((i) => ({
      label: i.label,
      helpText: i.helpText,
    })),
  };

  const contentHash = createHash('sha256')
    .update(`${KNOWLEDGE_CHECK_PROMPT_VERSION}\n${canonical(corpus)}`)
    .digest('hex');

  return { checklistVersion: checklist.version, corpus, contentHash };
}

// ---------------------------------------------------------------------------
// Prompt + structured output schema
// ---------------------------------------------------------------------------

const QUESTIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string' },
          category: {
            type: 'string',
            enum: ['SAFETY', 'SITE_RULES', 'EMERGENCY', 'HAZARD', 'GENERAL'],
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            minItems: OPTIONS_PER_QUESTION,
            maxItems: OPTIONS_PER_QUESTION,
          },
          correctIndex: {
            type: 'integer',
            minimum: 0,
            maximum: OPTIONS_PER_QUESTION - 1,
          },
          sourceRef: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: [
          'prompt',
          'category',
          'options',
          'correctIndex',
          'sourceRef',
          'explanation',
        ],
      },
    },
  },
  required: ['questions'],
};

const SYSTEM_PROMPT = [
  'You are a UK construction health-and-safety trainer writing a short knowledge',
  'check that verifies a worker understood THIS specific site induction.',
  '',
  'GROUNDING — the single most important rule:',
  '- Every question, its correct answer AND every option must come from a fact',
  '  EXPLICITLY STATED in the briefing below. Quote or closely paraphrase that',
  '  fact. If something is not written in the briefing, you do not know it — do',
  '  not ask about it and do not assume it.',
  '- Do NOT use general construction, health-and-safety or CSCS knowledge, common',
  '  practice, regulations, or anything a worker would need outside knowledge to',
  '  answer. Test comprehension of THIS briefing only.',
  '- A worker who has carefully read the briefing must be able to answer every',
  '  question with certainty. If you cannot write such a question from the stated',
  '  facts, write fewer questions.',
  '',
  'NEVER ask about (these are not induction facts):',
  '- whether something is or is not "listed", present, included or missing;',
  '- the wording, structure, layout, phrasing, categories or format of the',
  '  induction, checklist or briefing itself;',
  '- what a rule "asks", how it is worded, or its help text;',
  '- anything requiring a fact the briefing does not state (e.g. do not ask',
  '  whether an item is "mandatory" unless the briefing says so).',
  '',
  'Style:',
  `- Each question has exactly ${OPTIONS_PER_QUESTION} options, exactly ONE correct.`,
  '- The three wrong options must be clearly wrong given the briefing, not merely',
  '  "not mentioned". Never use "all/none of the above".',
  '- Categorise each: SAFETY, SITE_RULES, EMERGENCY, HAZARD or GENERAL.',
  '- Plain UK English, short sentences, low reading age. No trick wording.',
  '- `sourceRef`: quote the exact sentence/fact from the briefing the question tests.',
  '- `explanation`: one short sentence citing that stated fact.',
  '- Vary questions between runs.',
  '',
  'Quality over quantity: generate ONLY as many well-grounded questions as the',
  'briefing genuinely supports, up to the requested number. Returning fewer solid',
  'questions is REQUIRED — never pad with weak, generic or ungrounded questions.',
].join('\n');

/** Render the corpus as a plain briefing — never raw JSON/DB structure, so the
 *  model cannot quiz field names, item types or the induction's own format. */
function renderBriefing(corpus: InductionCorpus): string {
  const lines: string[] = [
    `SITE: ${corpus.siteName} (ref ${corpus.jobReference})`,
  ];

  lines.push('', 'INDUCTION NOTES:');
  lines.push(corpus.inductionContent.trim() || '(no free-text notes provided)');

  const e = corpus.emergency;
  const em: string[] = [];
  if (e.fireAssemblyPoint)
    em.push(`- Fire assembly point: ${e.fireAssemblyPoint}`);
  if (e.firstAiderName) {
    const bits = [e.firstAiderName];
    if (e.firstAiderLocation) bits.push(`at ${e.firstAiderLocation}`);
    if (e.firstAiderNumber) bits.push(`on ${e.firstAiderNumber}`);
    em.push(`- First aider: ${bits.join(', ')}`);
  }
  if (e.nearestHospital) em.push(`- Nearest A&E: ${e.nearestHospital}`);
  if (e.emergencyNumber) em.push(`- Emergency number: ${e.emergencyNumber}`);
  if (em.length) lines.push('', 'EMERGENCY INFORMATION:', ...em);

  if (corpus.checklistItems.length) {
    lines.push(
      '',
      'SITE RULES THE WORKER CONFIRMS (each is a rule/requirement in force on this site):',
    );
    for (const item of corpus.checklistItems) {
      lines.push(
        `- ${item.label}${item.helpText ? ` (${item.helpText})` : ''}`,
      );
    }
  }
  return lines.join('\n');
}

function buildUserPrompt(corpus: InductionCorpus, target: number): string {
  return [
    `Write up to ${target} multiple-choice questions that test whether a worker`,
    'understood the briefing below. Use ONLY facts stated in it. Fewer,',
    'well-grounded questions are better than more — do not invent or pad.',
    '',
    '--- SITE INDUCTION BRIEFING (the only source of truth) ---',
    renderBriefing(corpus),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Validation of model output
// ---------------------------------------------------------------------------

interface RawQuestion {
  prompt?: unknown;
  category?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  sourceRef?: unknown;
  explanation?: unknown;
}

interface ValidatedQuestion {
  prompt: string;
  category: KnowledgeQuestionCategory;
  options: { id: string; text: string }[];
  correctOptionId: string;
  sourceRef: string | null;
  explanation: string | null;
}

const CATEGORIES = new Set([
  'SAFETY',
  'SITE_RULES',
  'EMERGENCY',
  'HAZARD',
  'GENERAL',
]);

/**
 * Prompts/answers that test the induction's STRUCTURE rather than its content —
 * exactly the meta questions the prompt forbids. A cheap defence-in-depth filter
 * so any that slip past the model are dropped rather than shown to a worker.
 */
const META_PATTERNS = [
  /\bchecklist\b/i,
  /\bhelp ?text\b/i,
  /\bwhat (type|kind|category|format)\b/i,
  /\bnot (listed|included|mentioned|shown|present)\b/i,
  /\bwhich .*\bnot\b.*\b(listed|included|among|one of)\b/i,
  /\bhow (is|are) .* (worded|phrased|listed|written|labelled)\b/i,
  /\bwhat does the (checklist|induction|briefing|list) (ask|say|state)\b/i,
  /\b(PPE_CONFIRM|YES_NO|ACKNOWLEDGEMENT)\b/,
];

function isMetaQuestion(prompt: string, optionTexts: string[]): boolean {
  const haystack = [prompt, ...optionTexts].join('  ');
  return META_PATTERNS.some((re) => re.test(haystack));
}

function validateQuestion(raw: RawQuestion): ValidatedQuestion | null {
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (prompt.length < 8) return null;

  const opts = Array.isArray(raw.options)
    ? raw.options
        .map((o) => (typeof o === 'string' ? o.trim() : ''))
        .filter(Boolean)
    : [];
  // Exactly OPTIONS_PER_QUESTION distinct, non-empty options.
  const distinct = Array.from(new Set(opts.map((o) => o.toLowerCase())));
  if (
    opts.length !== OPTIONS_PER_QUESTION ||
    distinct.length !== OPTIONS_PER_QUESTION
  ) {
    return null;
  }

  const idx = typeof raw.correctIndex === 'number' ? raw.correctIndex : -1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= OPTIONS_PER_QUESTION)
    return null;

  // Drop structural/meta questions (defence-in-depth over the prompt rules).
  if (isMetaQuestion(prompt, opts)) return null;

  const category = (
    typeof raw.category === 'string' ? raw.category : 'GENERAL'
  ).toUpperCase();
  const cat = (
    CATEGORIES.has(category) ? category : 'GENERAL'
  ) as KnowledgeQuestionCategory;

  const options = opts.map((text, i) => ({ id: `o${i}`, text }));
  return {
    prompt,
    category: cat,
    options,
    correctOptionId: options[idx].id,
    sourceRef:
      typeof raw.sourceRef === 'string' && raw.sourceRef.trim()
        ? raw.sourceRef.trim()
        : null,
    explanation:
      typeof raw.explanation === 'string' && raw.explanation.trim()
        ? raw.explanation.trim()
        : null,
  };
}

// ---------------------------------------------------------------------------
// Deterministic local/CI fallback (mock provider)
// ---------------------------------------------------------------------------

/**
 * When the resolved provider is the deterministic mock (local/CI, no Azure key),
 * synthesise a small grounded bank from the corpus so the whole flow is testable
 * without a model or token spend. Never used in production (Azure OpenAI there).
 */
function buildMockQuestions(corpus: InductionCorpus): ValidatedQuestion[] {
  const q: ValidatedQuestion[] = [];
  const mk = (
    prompt: string,
    correct: string,
    distractors: string[],
    category: KnowledgeQuestionCategory,
    sourceRef: string,
  ): ValidatedQuestion => {
    const texts = [correct, ...distractors].slice(0, OPTIONS_PER_QUESTION);
    const options = texts.map((text, i) => ({ id: `o${i}`, text }));
    return {
      prompt,
      category,
      options,
      correctOptionId: 'o0',
      sourceRef,
      explanation: null,
    };
  };

  if (corpus.emergency.fireAssemblyPoint) {
    q.push(
      mk(
        'Where is the fire assembly point for this site?',
        corpus.emergency.fireAssemblyPoint,
        [
          'At the site entrance',
          'Behind the site office',
          'In the main car park (North side)',
        ],
        'EMERGENCY',
        'Emergency information',
      ),
    );
  }
  if (corpus.emergency.emergencyNumber) {
    q.push(
      mk(
        'What is the site emergency number?',
        corpus.emergency.emergencyNumber,
        ['111', '101', '112'],
        'EMERGENCY',
        'Emergency information',
      ),
    );
  }
  if (corpus.emergency.firstAiderName) {
    q.push(
      mk(
        'Who is the site first aider?',
        corpus.emergency.firstAiderName,
        [
          'There is no first aider',
          'The site manager only',
          'Any subcontractor',
        ],
        'EMERGENCY',
        'First aider',
      ),
    );
  }
  corpus.checklistItems
    .slice(0, 8)
    .forEach((item, i) =>
      q.push(
        mk(
          `Which statement reflects a site rule you confirmed at induction?`,
          item.label,
          [
            'Site rules do not apply to short visits',
            'You can start work before your induction',
            'PPE is optional in walkways',
          ],
          'SITE_RULES',
          item.label,
        ),
      ),
    );
  return q.slice(0, KNOWLEDGE_CHECK_DEFAULTS.poolTarget);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface EnsureBankResult {
  status: 'READY' | 'PENDING_APPROVAL' | 'UNAVAILABLE';
  bankId?: string;
}

/**
 * Ensure a usable (READY, and approved if the site requires it) question bank for
 * the site's current induction state, generating one if none exists. Returns
 * UNAVAILABLE on any generation problem so the caller can apply the site's
 * SKIP_FLAGGED / BLOCK policy — a model outage never throws into the worker flow.
 *
 * `requireApproval` reflects the site config: when true, a freshly generated bank
 * is left unapproved (PENDING_APPROVAL) until a manager publishes it.
 */
export async function ensureReadyBank(
  siteId: string,
  requireApproval: boolean,
): Promise<EnsureBankResult> {
  const induction = await loadBankInduction(siteId);
  if (!induction) return { status: 'UNAVAILABLE' };

  const key = {
    jobSiteId_checklistVersion_contentHash: {
      jobSiteId: siteId,
      checklistVersion: induction.checklistVersion,
      contentHash: induction.contentHash,
    },
  };

  const existing = await prisma.inductionQuestionBank.findUnique({
    where: key,
  });
  if (existing && existing.status === 'READY') {
    if (requireApproval && !existing.approvedAt) {
      return { status: 'PENDING_APPROVAL', bankId: existing.id };
    }
    return { status: 'READY', bankId: existing.id };
  }
  // A FAILED bank is retried; a fresh GENERATING one (<2 min) is left to its owner.
  if (existing && existing.status === 'GENERATING') {
    const ageMs = Date.now() - existing.updatedAt.getTime();
    if (ageMs < 2 * 60 * 1000) return { status: 'UNAVAILABLE' };
  }

  const generated = await generateBank(siteId, induction, requireApproval);
  return generated;
}

/**
 * Force a (re)generation for the site's current induction state — the manager
 * "Generate now" / "Regenerate" action. Same as ensureReadyBank but always
 * regenerates rather than reusing an existing READY bank.
 */
export async function regenerateBank(
  siteId: string,
  requireApproval: boolean,
): Promise<EnsureBankResult> {
  const induction = await loadBankInduction(siteId);
  if (!induction) return { status: 'UNAVAILABLE' };
  return generateBank(siteId, induction, requireApproval);
}

async function generateBank(
  siteId: string,
  induction: BankInduction,
  requireApproval: boolean,
): Promise<EnsureBankResult> {
  // Claim / create the bank row (unique on the induction state) and mark it
  // GENERATING so a concurrent caller backs off.
  const bank = await prisma.inductionQuestionBank.upsert({
    where: {
      jobSiteId_checklistVersion_contentHash: {
        jobSiteId: siteId,
        checklistVersion: induction.checklistVersion,
        contentHash: induction.contentHash,
      },
    },
    create: {
      jobSiteId: siteId,
      checklistVersion: induction.checklistVersion,
      contentHash: induction.contentHash,
      status: 'GENERATING',
    },
    update: { status: 'GENERATING', error: null },
    select: { id: true },
  });

  const runtime = await getAiRuntimeConfig();
  let validated: ValidatedQuestion[] = [];
  let provider = 'mock';
  let model = 'mock';

  try {
    const ai = await resolveAiProvider();
    provider = ai.name;
    if (ai.name === 'mock') {
      validated = buildMockQuestions(induction.corpus);
      model = 'mock';
    } else {
      const result = await ai.complete({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(
          induction.corpus,
          KNOWLEDGE_CHECK_DEFAULTS.poolTarget,
        ),
        schema: QUESTIONS_SCHEMA,
        // No explicit temperature: the production deployment is a GPT-5 reasoning
        // model, which rejects any temperature other than the default (1) with a
        // 400. The provider only forwards temperature when a caller sets one, so
        // omitting it uses the model default — matching the AI Summaries call.
        //
        // The budget must be generous: a reasoning model spends a large, variable
        // share of it on hidden reasoning tokens BEFORE any visible answer, so a
        // pool of ~18 questions needs headroom for reasoning (~2.5–4k) plus the
        // JSON output (~4–5k). At 4000 the model consumed the entire budget on
        // reasoning and returned empty content (finish_reason "length") → zero
        // questions. 12000 leaves comfortable headroom and finishes cleanly.
        maxOutputTokens: 12000,
      });
      model = result.model;
      const parsed = (result.json ?? safeParse(result.text)) as {
        questions?: RawQuestion[];
      } | null;
      const raw = Array.isArray(parsed?.questions) ? parsed!.questions! : [];
      validated = raw
        .map(validateQuestion)
        .filter((q): q is ValidatedQuestion => q !== null);
    }
  } catch (error) {
    const message =
      error instanceof AiError ? error.message : 'Generation failed.';
    await prisma.inductionQuestionBank.update({
      where: { id: bank.id },
      data: { status: 'FAILED', error: message.slice(0, 500), provider, model },
    });
    return { status: 'UNAVAILABLE' };
  }

  if (validated.length < KNOWLEDGE_CHECK_DEFAULTS.poolMinimum) {
    await prisma.inductionQuestionBank.update({
      where: { id: bank.id },
      data: {
        status: 'FAILED',
        error: `Only ${validated.length} valid questions (need ${KNOWLEDGE_CHECK_DEFAULTS.poolMinimum}).`,
        provider,
        model,
      },
    });
    return { status: 'UNAVAILABLE' };
  }

  const approvedNow = !requireApproval;
  await prisma.$transaction([
    prisma.inductionQuestion.deleteMany({ where: { bankId: bank.id } }),
    prisma.inductionQuestionBank.update({
      where: { id: bank.id },
      data: {
        status: 'READY',
        provider,
        model,
        promptVersion: KNOWLEDGE_CHECK_PROMPT_VERSION,
        error: null,
        approvedAt: approvedNow ? new Date() : null,
        approvedByName: approvedNow ? 'Auto-published' : null,
        questions: {
          create: validated.map((q, index) => ({
            order: index,
            category: q.category,
            prompt: q.prompt,
            options: q.options,
            correctOptionId: q.correctOptionId,
            sourceRef: q.sourceRef,
            explanation: q.explanation,
          })),
        },
      },
    }),
  ]);

  return approvedNow
    ? { status: 'READY', bankId: bank.id }
    : { status: 'PENDING_APPROVAL', bankId: bank.id };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
