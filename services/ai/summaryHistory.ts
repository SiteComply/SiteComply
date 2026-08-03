import { AiSummaryTarget } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { canUseAiSummaries } from '@/services/ai/aiConfig';
import { resolvePage } from '@/lib/pagination';
import {
  SUMMARY_TARGETS,
  type SummaryOpts,
  getSummaryTarget,
} from '@/services/ai/summaryTargets';
import { parseSummaryOutput, type SummaryOutput } from '@/services/ai/prompts';

/**
 * AI Summary History (read-only browse of previously generated summaries).
 *
 * Every access goes through the SAME gates as generation — the capability gate
 * (canUseAiSummaries), the per-target authorisation (target.authorize) and
 * site-scoping. Site-scoping is enforced twice over: history is grouped by the
 * exact cache key (targetType + targetKey) the summary was generated under, and
 * every returned row must have a scope snapshot (siteIds) that is a SUBSET of the
 * viewer's current sites — so a summary built from any site the viewer can't see
 * is never surfaced. Reads a stored summary; it never calls the model.
 */

export type HistoryReason =
  | 'disabled'
  | 'forbidden'
  | 'bad_target'
  | 'not_found';

const PAGE_SIZE = 10;

// Upper bound on rows scanned for one target+key bucket before scope-filtering.
// Far above any real bucket size at pilot volume (global cap is 1000/month).
const BUCKET_SCAN_CAP = 500;

export interface HistoryItem {
  id: string;
  createdAt: string;
  generatedByName: string | null;
  targetType: AiSummaryTarget;
  provider: string;
  model: string;
  promptVersion: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export interface HistoryDetail {
  id: string;
  summary: SummaryOutput;
  createdAt: string;
  generatedByName: string | null;
  targetType: AiSummaryTarget;
  provider: string;
  model: string;
  promptVersion: string;
}

type Result<T> = { ok: true; data: T } | { ok: false; reason: HistoryReason };

/** True only when every site in the summary's scope snapshot is one the viewer can see. */
function scopeVisibleToViewer(
  siteIds: unknown,
  viewer: PlatformViewer,
): boolean {
  if (!Array.isArray(siteIds)) return false;
  const scope = new Set(viewer.siteIds);
  return siteIds.every((s) => typeof s === 'string' && scope.has(s));
}

/**
 * List previously generated summaries for the report/record the viewer is
 * looking at (same targetType + resolved targetKey), newest first, paginated.
 */
export async function listSummaryHistory(
  viewer: PlatformViewer,
  targetType: AiSummaryTarget,
  opts: SummaryOpts,
  rawPage: string | undefined,
): Promise<Result<HistoryPage>> {
  if (!(await canUseAiSummaries(viewer.role)))
    return { ok: false, reason: 'disabled' };

  const target = getSummaryTarget(targetType);
  if (!target) return { ok: false, reason: 'bad_target' };
  if (!target.authorize(viewer, opts))
    return { ok: false, reason: 'forbidden' };

  const key = await target.resolveKey(viewer, opts);
  if (!key) return { ok: false, reason: 'not_found' };

  const rows = await prisma.aiSummary.findMany({
    where: { targetType, targetKey: key.targetKey, status: 'OK' },
    orderBy: { createdAt: 'desc' },
    take: BUCKET_SCAN_CAP,
    select: {
      id: true,
      createdAt: true,
      provider: true,
      model: true,
      promptVersion: true,
      siteIds: true,
      platformUser: { select: { name: true } },
    },
  });

  const visible = rows.filter((r) => scopeVisibleToViewer(r.siteIds, viewer));
  const { page, pageSize, pageCount, total, skip, take } = resolvePage(
    rawPage,
    visible.length,
    PAGE_SIZE,
  );

  const items: HistoryItem[] = visible.slice(skip, skip + take).map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    generatedByName: r.platformUser?.name ?? null,
    targetType,
    provider: r.provider,
    model: r.model,
    promptVersion: r.promptVersion,
  }));

  return { ok: true, data: { items, page, pageSize, pageCount, total } };
}

/**
 * Open one stored summary for reading (no regeneration). Re-checks the capability
 * gate, the per-target authorisation and site-scoping against the row's snapshot.
 */
export async function getSummaryHistoryItem(
  viewer: PlatformViewer,
  id: string,
): Promise<Result<HistoryDetail>> {
  if (!(await canUseAiSummaries(viewer.role)))
    return { ok: false, reason: 'disabled' };

  const row = await prisma.aiSummary.findUnique({
    where: { id },
    select: {
      id: true,
      targetType: true,
      targetKey: true,
      siteIds: true,
      status: true,
      summary: true,
      provider: true,
      model: true,
      promptVersion: true,
      createdAt: true,
      platformUser: { select: { name: true } },
    },
  });
  if (!row || row.status !== 'OK') return { ok: false, reason: 'not_found' };

  const target = getSummaryTarget(row.targetType);
  if (!target) return { ok: false, reason: 'not_found' };

  // Same authorisation the target enforces for generation (e.g. Org Overview is
  // Director-only; audits/actions need the module 'view' permission)...
  if (!target.authorize(viewer, { targetKey: row.targetKey }))
    return { ok: false, reason: 'forbidden' };
  // ...plus the scope snapshot must be entirely within the viewer's sites.
  if (!scopeVisibleToViewer(row.siteIds, viewer))
    return { ok: false, reason: 'forbidden' };

  const summary = parseSummaryOutput(row.summary);
  if (!summary) return { ok: false, reason: 'not_found' };

  return {
    ok: true,
    data: {
      id: row.id,
      summary,
      createdAt: row.createdAt.toISOString(),
      generatedByName: row.platformUser?.name ?? null,
      targetType: row.targetType,
      provider: row.provider,
      model: row.model,
      promptVersion: row.promptVersion,
    },
  };
}
