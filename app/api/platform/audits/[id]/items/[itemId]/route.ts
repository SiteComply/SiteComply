import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { setItemResult } from '@/services/audits/auditScoringService';

/**
 * SC-014 — record the auditor's answer to one checklist item (PASS / FAIL / NA,
 * or null to clear) plus an optional note, then recalculate the audit score.
 * Points awarded are derived server-side from the item's configured points, so a
 * client can never award itself a score.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  let body: { result?: string | null; note?: string | null };
  try {
    body = (await req.json()) as {
      result?: string | null;
      note?: string | null;
    };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await setItemResult(
    viewer,
    params.id,
    params.itemId,
    body.result ?? null,
    body.note,
  );

  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : result.reason === 'signed_off'
            ? 409
            : 400;
    return NextResponse.json(
      {
        ok: false,
        error:
          result.error ??
          (result.reason === 'signed_off'
            ? 'This audit has been signed off and can no longer be changed.'
            : result.reason === 'forbidden'
              ? 'You do not have permission to record audit results.'
              : 'Checklist item not found.'),
      },
      { status },
    );
  }

  return NextResponse.json({ ok: true });
}
