import { NextRequest, NextResponse } from 'next/server';
import { AiSummaryTarget } from '@prisma/client';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { isAiSummaryTarget } from '@/services/ai/aiConstants';
import {
  listSummaryHistory,
  type HistoryReason,
} from '@/services/ai/summaryHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/ai/summary/history
 * Query: targetType, targetKey?, from?, to?, sites? (csv), page?
 *
 * List previously generated summaries for the report/record the viewer is on.
 * Read-only — never calls the model. Same enforcement as generation:
 *   - getPlatformViewer (401)
 *   - feature disabled → 404 (behaves as absent)
 *   - pilot role allow-list + per-target permission → 403
 *   - resolved target key out of scope → 404
 *   - each row scope-filtered to the viewer's sites
 */
const STATUS: Record<HistoryReason, number> = {
  disabled: 404,
  forbidden: 403,
  bad_target: 400,
  not_found: 404,
};
const MESSAGE: Record<HistoryReason, string> = {
  disabled: 'Not found.',
  forbidden: 'You do not have permission to view this summary history.',
  bad_target: 'Unknown summary target.',
  not_found: 'No history is available for your access.',
};

export async function GET(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const targetType = sp.get('targetType');
  if (!targetType || !isAiSummaryTarget(targetType)) {
    return NextResponse.json({ ok: false, error: 'Unknown summary target.' }, { status: 400 });
  }

  const sites = sp.get('sites');
  const filters = {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    sites: sites ? sites.split(',').filter(Boolean) : undefined,
  };

  const result = await listSummaryHistory(
    viewer,
    targetType as AiSummaryTarget,
    { targetKey: sp.get('targetKey') ?? undefined, filters },
    sp.get('page') ?? undefined,
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: MESSAGE[result.reason] },
      { status: STATUS[result.reason] },
    );
  }

  return NextResponse.json({ ok: true, ...result.data });
}
