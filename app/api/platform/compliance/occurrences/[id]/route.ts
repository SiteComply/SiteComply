import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  startOccurrence,
  completeOccurrence,
} from '@/services/compliance/occurrenceService';

export const dynamic = 'force-dynamic';

/**
 * SC-020 Phase 1 — progress a generated occurrence.
 *
 * `start` creates a real audit from the schedule's template and links it, which
 * is the join to SC-013 provenance and SC-014 scoring: a scheduled inspection
 * becomes an ordinary audit, so findings, actions and compliance scoring need no
 * special cases.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    body = {};
  }

  const result =
    body.action === 'complete'
      ? await completeOccurrence(viewer, params.id)
      : body.action === 'start'
        ? await startOccurrence(viewer, params.id)
        : null;

  if (!result) {
    return NextResponse.json(
      { ok: false, error: 'Unknown action.' },
      { status: 400 },
    );
  }
  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    return NextResponse.json(
      {
        ok: false,
        error:
          result.error ??
          (result.reason === 'forbidden'
            ? 'You do not have permission to do that.'
            : 'Activity not found.'),
      },
      { status },
    );
  }
  return NextResponse.json({ ok: true, auditId: result.auditId ?? null });
}
