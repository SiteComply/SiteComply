import { NextRequest, NextResponse } from 'next/server';
import { AiSummaryTarget } from '@prisma/client';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { isAiSummaryTarget } from '@/services/ai/aiConstants';
import {
  generateSummary,
  type SummaryReason,
} from '@/services/ai/summaryService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/ai/summary
 * Body: { targetType, targetKey?, filters?: { from?, to?, sites?[] } }
 *
 * Generate an AI executive summary for a report/audit/register the viewer is
 * authorised to see. Enforcement (all upstream of the model):
 *   - getPlatformViewer (401)
 *   - feature flag OFF → 404 (the endpoint behaves as absent in production)
 *   - pilot role allow-list + per-target permission (canRunReport / permits) → 403
 *   - viewer-scoped context builder → 404 if out of scope
 *   - conservative pilot usage caps → 429
 *
 * Phase 1b: present but NOT enabled and NOT surfaced in any UI — while
 * AI_SUMMARIES_ENABLED is unset this returns 404 for everyone.
 */
const STATUS: Record<SummaryReason, number> = {
  disabled: 404,
  forbidden: 403,
  bad_target: 400,
  not_found: 404,
  rate_limited: 429,
  daily_cap: 429,
  monthly_cap: 429,
  provider_error: 502,
};

const MESSAGE: Record<SummaryReason, string> = {
  disabled: 'Not found.',
  forbidden: 'You do not have permission to generate this summary.',
  bad_target: 'Unknown summary target.',
  not_found: 'Nothing to summarise for your access.',
  rate_limited: 'Please wait a few seconds before generating another summary.',
  daily_cap: 'You have reached the daily AI summary limit. Please try again tomorrow.',
  monthly_cap: 'AI summaries are paused — the monthly pilot limit has been reached.',
  provider_error: 'The summary could not be generated right now. Please try again.',
};

export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  let body: { targetType?: string; targetKey?: string; filters?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  if (!body.targetType || !isAiSummaryTarget(body.targetType)) {
    return NextResponse.json({ ok: false, error: 'Unknown summary target.' }, { status: 400 });
  }

  const filters =
    body.filters && typeof body.filters === 'object'
      ? (body.filters as { from?: string; to?: string; sites?: string[] })
      : undefined;

  const result = await generateSummary(viewer, body.targetType as AiSummaryTarget, {
    targetKey: typeof body.targetKey === 'string' ? body.targetKey : undefined,
    filters,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: MESSAGE[result.reason] },
      { status: STATUS[result.reason] },
    );
  }

  return NextResponse.json({
    ok: true,
    summary: result.summary,
    cached: result.cached,
  });
}
