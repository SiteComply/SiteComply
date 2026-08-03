import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { AiError } from '@/services/ai';
import {
  getAiRuntimeConfig,
  resolveAiProvider,
} from '@/services/ai/aiConfigService';
import {
  recordAiSummary,
  countAiSummariesToday,
  countAiSummariesThisMonth,
  lastAiSummaryAt,
} from '@/services/ai/aiSummaryLog';
import {
  renderPack,
  canGenerateCloseOutPack,
} from '@/services/closeOut/closeOutService';
import {
  CLOSE_OUT_MAX_OUTPUT_TOKENS,
  CLOSE_OUT_NARRATIVE_SCHEMA,
  CLOSE_OUT_PROMPT_VERSION,
  CLOSE_OUT_SYSTEM_PROMPT,
  buildCloseOutUserPrompt,
  parseCloseOutNarrative,
  type CloseOutNarrative,
} from '@/services/closeOut/closeOutNarrative';

/**
 * SC-024 Phase 3 — generating the AI narrative for a close-out pack.
 *
 * This deliberately does NOT go through `generateSummary`. That pipeline is
 * built around one fixed output shape (headline + risks + recommended actions)
 * and a TTL cache, and it is live for six targets with real production usage.
 * A close-out pack needs a different shape, a different prompt, an output guard,
 * and NO cache — the prose belongs to the pack revision, not to a 24-hour
 * window. Rather than bend a working feature into two shapes, this reuses its
 * PARTS: the same runtime config, the same provider resolution, the same usage
 * caps and the same AiSummary audit log.
 *
 * The pack is perfectly valid with no narrative. Every failure path here leaves
 * the pack intact and returns a reason.
 */

export type NarrativeReason =
  | 'disabled'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'daily_cap'
  | 'monthly_cap'
  | 'provider_error'
  | 'rejected';

export type NarrativeResult =
  | {
      ok: true;
      narrative: CloseOutNarrative;
      provider: string;
      model: string;
      generatedAt: Date;
    }
  | { ok: false; reason: NarrativeReason; detail?: string };

export const NARRATIVE_MESSAGES: Record<NarrativeReason, string> = {
  disabled: 'AI summaries are turned off for this organisation.',
  forbidden: 'Your role cannot generate AI narratives.',
  not_found: 'Pack not found.',
  rate_limited: 'Please wait a moment before generating again.',
  daily_cap: 'You have reached your daily AI generation limit.',
  monthly_cap: 'The organisation has reached its monthly AI generation limit.',
  provider_error:
    'The AI service could not be reached. The pack is unaffected.',
  rejected:
    'The generated text was rejected because it drew a compliance conclusion. The pack is unaffected.',
};

/**
 * The PII-safe context sent to the model.
 *
 * Counts and labels only. No worker names, no phone numbers, no addresses, no
 * finding text — a close-out narrative needs to know that a section holds 14
 * permits, not who requested them. This is also why the model cannot leak
 * anything the viewer could not see: the context is built from `renderPack`,
 * which is already permission-filtered.
 */
function buildContext(
  pack: NonNullable<Awaited<ReturnType<typeof renderPack>>>,
) {
  return {
    project: {
      name: pack.site.name,
      jobReference: pack.site.jobReference,
      generatedOn: pack.generatedAt.toISOString().slice(0, 10),
      version: pack.version,
    },
    sections: pack.sections.map((s) => ({
      sectionId: s.id,
      label: s.label,
      recordCount: s.rows ? s.rows.length : null,
      photoCount: s.photos ? s.photos.length : null,
      // Facts are already display-safe label/value pairs (dates, counts,
      // settings) — never free text about a person.
      facts: s.facts
        ? s.facts.map((f) => ({ label: f.label, value: f.value }))
        : null,
      capped: s.cappedNote ? true : false,
    })),
  };
}

function hashContext(context: unknown): string {
  return createHash('sha256')
    .update(`${CLOSE_OUT_PROMPT_VERSION}\n${JSON.stringify(context)}`)
    .digest('hex');
}

/**
 * Generate the narrative and store it on the pack.
 *
 * Regenerating overwrites: a pack has one narrative, and the AiSummary log
 * retains every attempt including the overwritten ones.
 */
export async function generateCloseOutNarrative(
  viewer: PlatformViewer,
  packId: string,
): Promise<NarrativeResult> {
  // 1. Capability gate — the same runtime AiConfig the rest of the AI features
  //    use, so turning AI off turns this off too. Note the allowed-roles list is
  //    typically narrower than pack generation: a Site Manager can generate a
  //    pack and simply gets no AI narrative. The gate may only narrow.
  const runtime = await getAiRuntimeConfig();
  if (!runtime.enabled) return { ok: false, reason: 'disabled' };
  if (!runtime.allowedRoles.has(viewer.role.toUpperCase()))
    return { ok: false, reason: 'forbidden' };
  if (!canGenerateCloseOutPack(viewer.role))
    return { ok: false, reason: 'forbidden' };

  // 2. renderPack applies the site boundary AND per-section permissions, so the
  //    context can never describe data this viewer cannot see.
  const pack = await renderPack(viewer, packId);
  if (!pack) return { ok: false, reason: 'not_found' };

  const row = await prisma.closeOutPack.findUnique({
    where: { id: packId },
    select: { jobSiteId: true },
  });
  if (!row) return { ok: false, reason: 'not_found' };

  // 3. Usage caps — shared with the rest of the AI features, so a close-out
  //    narrative counts against the same budget.
  const caps = runtime.caps;
  const last = await lastAiSummaryAt(viewer.id);
  if (last && (Date.now() - last.getTime()) / 1000 < caps.minIntervalSeconds)
    return { ok: false, reason: 'rate_limited' };
  if ((await countAiSummariesToday(viewer.id)) >= caps.dailyPerUser)
    return { ok: false, reason: 'daily_cap' };
  if ((await countAiSummariesThisMonth()) >= caps.monthlyGlobal)
    return { ok: false, reason: 'monthly_cap' };

  const context = buildContext(pack);
  const contextHash = hashContext(context);
  const provider = await resolveAiProvider();

  const logBase = {
    targetType: 'CLOSE_OUT_PACK' as const,
    targetKey: packId,
    platformUserId: viewer.id,
    role: viewer.role as Parameters<typeof recordAiSummary>[0]['role'],
    siteIds: [row.jobSiteId],
    contextHash,
    provider: provider.name,
    promptVersion: CLOSE_OUT_PROMPT_VERSION,
  };

  try {
    const result = await provider.complete({
      system: CLOSE_OUT_SYSTEM_PROMPT,
      user: buildCloseOutUserPrompt(
        `${pack.site.name} (${pack.site.jobReference})`,
        context,
      ),
      schema: CLOSE_OUT_NARRATIVE_SCHEMA,
      maxOutputTokens: CLOSE_OUT_MAX_OUTPUT_TOKENS,
    });

    const parsed = parseCloseOutNarrative(
      result.json ?? result.text,
      pack.sections.map((s) => s.id),
    );

    if (!parsed.ok) {
      // Recorded as FAILED with the reason, so a model that keeps drawing
      // conclusions is visible in the audit log rather than silently retried.
      await recordAiSummary({
        ...logBase,
        model: result.model,
        status: 'FAILED',
        errorReason: parsed.reason,
      });
      const rejected = parsed.reason.includes('not permitted');
      return {
        ok: false,
        reason: rejected ? 'rejected' : 'provider_error',
        detail: parsed.reason,
      };
    }

    const generatedAt = new Date();
    await recordAiSummary({
      ...logBase,
      model: result.model,
      summary: parsed.narrative as unknown as Prisma.InputJsonValue,
      tokensPrompt: result.tokensPrompt ?? null,
      tokensOutput: result.tokensOutput ?? null,
      status: 'OK',
    });

    // Stored ON the pack: this prose is part of the handover artefact and must
    // not change when the cache expires or the underlying records move on.
    await prisma.closeOutPack.update({
      where: { id: packId },
      data: {
        aiSummary: JSON.stringify(parsed.narrative),
        aiPromptVersion: CLOSE_OUT_PROMPT_VERSION,
        aiGeneratedAt: generatedAt,
        aiModel: result.model,
        aiProvider: provider.name,
        aiGeneratedBy: viewer.name,
      },
    });

    return {
      ok: true,
      narrative: parsed.narrative,
      provider: provider.name,
      model: result.model,
      generatedAt,
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

/** Remove the narrative from a pack, leaving the audit log intact. */
export async function clearCloseOutNarrative(
  viewer: PlatformViewer,
  packId: string,
): Promise<boolean> {
  const pack = await prisma.closeOutPack.findUnique({
    where: { id: packId },
    select: { jobSiteId: true },
  });
  if (!pack) return false;
  if (!canGenerateCloseOutPack(viewer.role)) return false;
  if (!viewer.siteIds.includes(pack.jobSiteId)) return false;

  await prisma.closeOutPack.update({
    where: { id: packId },
    data: {
      aiSummary: null,
      aiPromptVersion: null,
      aiGeneratedAt: null,
      aiModel: null,
      aiProvider: null,
      aiGeneratedBy: null,
    },
  });
  return true;
}

/** The stored narrative for a pack, or null. Safe against malformed JSON. */
export function readStoredNarrative(
  raw: string | null,
  allowedSectionIds: string[],
): CloseOutNarrative | null {
  if (!raw) return null;
  const parsed = parseCloseOutNarrative(raw, allowedSectionIds);
  return parsed.ok ? parsed.narrative : null;
}
