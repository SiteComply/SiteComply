import { AiSummaryTarget, PlatformRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * AI Summaries audit log + usage accounting (Phase 1a foundation).
 *
 * Every generation attempt is recorded in the AiSummary table — the
 * accountability trail (who, when, what scope, which model) and the basis for
 * cost tracking and the pilot usage caps. Mirrors ReportExportLog. No user-facing
 * surface consumes these yet; they exist so the summary flow (a later phase) can
 * record and cap without further schema work.
 */

export interface RecordAiSummaryInput {
  targetType: AiSummaryTarget;
  targetKey: string;
  platformUserId?: string | null;
  role: PlatformRole;
  siteIds: string[];
  contextHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  summary?: Prisma.InputJsonValue | null;
  tokensPrompt?: number | null;
  tokensOutput?: number | null;
  status: 'OK' | 'FAILED';
  errorReason?: string | null;
}

/** Write one AiSummary row (a generation attempt — successful or failed). */
export function recordAiSummary(input: RecordAiSummaryInput) {
  return prisma.aiSummary.create({
    data: {
      targetType: input.targetType,
      targetKey: input.targetKey,
      platformUserId: input.platformUserId ?? null,
      role: input.role,
      siteIds: input.siteIds,
      contextHash: input.contextHash,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      summary: input.summary ?? Prisma.JsonNull,
      tokensPrompt: input.tokensPrompt ?? null,
      tokensOutput: input.tokensOutput ?? null,
      status: input.status,
      errorReason: input.errorReason ?? null,
    },
    select: { id: true },
  });
}

/** Count a user's successful live generations since UTC midnight (daily cap). */
export function countAiSummariesToday(
  platformUserId: string,
  now: Date = new Date(),
): Promise<number> {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return prisma.aiSummary.count({
    where: { platformUserId, status: 'OK', createdAt: { gte: start } },
  });
}

/** Count all successful live generations this calendar month (global cap). */
export function countAiSummariesThisMonth(
  now: Date = new Date(),
): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return prisma.aiSummary.count({
    where: { status: 'OK', createdAt: { gte: start } },
  });
}

/** Most recent generation time for a user (for the min-interval rate limit). */
export async function lastAiSummaryAt(
  platformUserId: string,
): Promise<Date | null> {
  const row = await prisma.aiSummary.findFirst({
    where: { platformUserId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}
