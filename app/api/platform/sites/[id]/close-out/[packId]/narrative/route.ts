import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  generateCloseOutNarrative,
  clearCloseOutNarrative,
  NARRATIVE_MESSAGES,
} from '@/services/closeOut/closeOutAi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 3 — the AI narrative for a close-out pack.
 *
 * POST generates and stores it; DELETE removes it. Both are gated by the AI
 * runtime config AND the pack permissions, and the narrative is built from the
 * permission-filtered render, so it can never describe data the caller cannot
 * see.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; packId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );

  const result = await generateCloseOutNarrative(viewer, params.packId);
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      narrative: result.narrative,
      provider: result.provider,
      model: result.model,
      generatedAt: result.generatedAt.toISOString(),
    });
  }

  const status =
    result.reason === 'forbidden' || result.reason === 'disabled'
      ? 403
      : result.reason === 'not_found'
        ? 404
        : result.reason === 'rate_limited' ||
            result.reason === 'daily_cap' ||
            result.reason === 'monthly_cap'
          ? 429
          : 502;

  return NextResponse.json(
    {
      ok: false,
      reason: result.reason,
      error: NARRATIVE_MESSAGES[result.reason],
      detail: result.detail,
    },
    { status },
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; packId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );

  const ok = await clearCloseOutNarrative(viewer, params.packId);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json(
        { ok: false, error: 'Pack not found.' },
        { status: 404 },
      );
}
