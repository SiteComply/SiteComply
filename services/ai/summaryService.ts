import { createHash } from 'crypto';
import { AiSummaryTarget, PlatformRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { AiError } from '@/services/ai';
import {
  getAiRuntimeConfig,
  resolveAiProvider,
} from '@/services/ai/aiConfigService';
import { AI_SUMMARY_PROMPT_VERSION } from '@/services/ai/aiConstants';
import {
  SUMMARY_SYSTEM_PROMPT,
  SUMMARY_SCHEMA,
  SUMMARY_MAX_OUTPUT_TOKENS,
  buildUserPrompt,
  parseSummaryOutput,
  type SummaryOutput,
} from '@/services/ai/prompts';
import { SUMMARY_TARGETS, type SummaryOpts } from '@/services/ai/summaryTargets';
import {
  recordAiSummary,
  countAiSummariesToday,
  countAiSummariesThisMonth,
  lastAiSummaryAt,
} from '@/services/ai/aiSummaryLog';

/**
 * AI Summary orchestrator (Phase 1b). Ties together the capability gate,
 * per-target authorisation, the viewer-scoped context builder, caching, the
 * pilot usage caps, the (mock/Azure OpenAI) provider and the audit log.
 *
 * Every generation goes through this one path, so RBAC + site-scoping are always
 * enforced upstream of the model. While the feature flag is off (production
 * default) `generateSummary` returns `disabled` and nothing runs.
 */

export type SummaryReason =
  | 'disabled'
  | 'forbidden'
  | 'bad_target'
  | 'not_found'
  | 'rate_limited'
  | 'daily_cap'
  | 'monthly_cap'
  | 'provider_error';

export type SummaryResult =
  | {
      ok: true;
      summary: SummaryOutput;
      cached: boolean;
      provider: string;
      model: string;
      generatedAt: string;
    }
  | { ok: false; reason: SummaryReason };

/**
 * Deterministic hash of the scoped context → cache key + change detection. The
 * prompt version is mixed in so a prompt/format change regenerates the summary
 * instead of serving a result written by the previous template.
 */
function hashContext(context: unknown): string {
  return createHash('sha256')
    .update(`${AI_SUMMARY_PROMPT_VERSION}\n${canonical(context)}`)
    .digest('hex');
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

async function findCachedSummary(
  targetType: AiSummaryTarget,
  targetKey: string,
  contextHash: string,
  ttlHours: number,
): Promise<{
  summary: SummaryOutput;
  provider: string;
  model: string;
  createdAt: Date;
} | null> {
  if (ttlHours <= 0) return null;
  const since = new Date(Date.now() - ttlHours * 3600 * 1000);
  const row = await prisma.aiSummary.findFirst({
    where: { targetType, targetKey, contextHash, status: 'OK', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { summary: true, provider: true, model: true, createdAt: true },
  });
  if (!row) return null;
  const summary = parseSummaryOutput(row.summary);
  if (!summary) return null;
  return { summary, provider: row.provider, model: row.model, createdAt: row.createdAt };
}

export async function generateSummary(
  viewer: PlatformViewer,
  targetType: AiSummaryTarget,
  opts: SummaryOpts,
): Promise<SummaryResult> {
  // 1. Capability gate — runtime AiConfig (enabled + allowed roles).
  const runtime = await getAiRuntimeConfig();
  if (!runtime.enabled) return { ok: false, reason: 'disabled' };
  if (!runtime.allowedRoles.has(viewer.role.toUpperCase()))
    return { ok: false, reason: 'forbidden' };

  const target = SUMMARY_TARGETS[targetType];
  if (!target) return { ok: false, reason: 'bad_target' };

  // 2. Per-target authorisation — reuses canRunReport / permits (Org Overview
  //    stays Director-only, etc.).
  if (!target.authorize(viewer, opts)) return { ok: false, reason: 'forbidden' };

  // 3. Build the viewer-scoped, PII-safe context (null = out of scope / missing).
  const built = await target.build(viewer, opts);
  if (!built) return { ok: false, reason: 'not_found' };

  const contextHash = hashContext(built.context);
  const caps = runtime.caps;

  // 4. Cache — a cache hit costs nothing and does not count against any cap.
  const cached = await findCachedSummary(
    targetType,
    built.targetKey,
    contextHash,
    caps.cacheTtlHours,
  );
  if (cached)
    return {
      ok: true,
      summary: cached.summary,
      cached: true,
      provider: cached.provider,
      model: cached.model,
      generatedAt: cached.createdAt.toISOString(),
    };

  // 5. Pilot usage caps (only live generations count).
  const last = await lastAiSummaryAt(viewer.id);
  if (last && (Date.now() - last.getTime()) / 1000 < caps.minIntervalSeconds)
    return { ok: false, reason: 'rate_limited' };
  if ((await countAiSummariesToday(viewer.id)) >= caps.dailyPerUser)
    return { ok: false, reason: 'daily_cap' };
  if ((await countAiSummariesThisMonth()) >= caps.monthlyGlobal)
    return { ok: false, reason: 'monthly_cap' };

  // 6. Generate via the runtime-resolved provider (mock by default).
  const provider = await resolveAiProvider();
  const user = buildUserPrompt(targetType, target.label, built.scopeLabel, built.context);

  const logBase = {
    targetType,
    targetKey: built.targetKey,
    platformUserId: viewer.id,
    role: viewer.role as PlatformRole,
    siteIds: built.siteIds,
    contextHash,
    provider: provider.name,
    promptVersion: AI_SUMMARY_PROMPT_VERSION,
  };

  try {
    const result = await provider.complete({
      system: SUMMARY_SYSTEM_PROMPT,
      user,
      schema: SUMMARY_SCHEMA,
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    });
    const summary = parseSummaryOutput(result.json ?? result.text);
    if (!summary) {
      await recordAiSummary({
        ...logBase,
        model: result.model,
        status: 'FAILED',
        errorReason: 'Model returned an unusable response.',
      });
      return { ok: false, reason: 'provider_error' };
    }
    await recordAiSummary({
      ...logBase,
      model: result.model,
      summary: summary as unknown as Prisma.InputJsonValue,
      tokensPrompt: result.tokensPrompt ?? null,
      tokensOutput: result.tokensOutput ?? null,
      status: 'OK',
    });
    return {
      ok: true,
      summary,
      cached: false,
      provider: provider.name,
      model: result.model,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    await recordAiSummary({
      ...logBase,
      model: 'unknown',
      status: 'FAILED',
      errorReason:
        error instanceof AiError ? error.message : 'Unexpected provider error.',
    });
    return { ok: false, reason: 'provider_error' };
  }
}
