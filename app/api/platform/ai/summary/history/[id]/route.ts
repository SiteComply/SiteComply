import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  getSummaryHistoryItem,
  type HistoryReason,
} from '@/services/ai/summaryHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/ai/summary/history/[id]
 *
 * Open one stored summary for reading (no regeneration). Re-checks the capability
 * gate, per-target authorisation and site-scoping against the row's own scope
 * snapshot, so an id alone can never leak a summary outside the viewer's access.
 */
const STATUS: Record<HistoryReason, number> = {
  disabled: 404,
  forbidden: 403,
  bad_target: 400,
  not_found: 404,
};
const MESSAGE: Record<HistoryReason, string> = {
  disabled: 'Not found.',
  forbidden: 'You do not have permission to view this summary.',
  bad_target: 'Unknown summary target.',
  not_found: 'This summary is no longer available.',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  const result = await getSummaryHistoryItem(viewer, params.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: MESSAGE[result.reason] },
      { status: STATUS[result.reason] },
    );
  }

  return NextResponse.json({ ok: true, ...result.data });
}
