import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  saveScoringConfig,
  type SaveScoringInput,
} from '@/services/audits/auditScoringService';

/**
 * SC-014 — persist an audit's scoring configuration (method, options, section
 * weightings, per-question rules and custom score bands) in one call, then
 * recalculate the score. Guarded by `audits:edit` + site scope inside the
 * service; a SIGNED_OFF audit is frozen.
 */
export async function PUT(
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

  let body: SaveScoringInput;
  try {
    body = (await req.json()) as SaveScoringInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (
    !body ||
    !Array.isArray(body.sections) ||
    !Array.isArray(body.items) ||
    !Array.isArray(body.scoreBands)
  ) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await saveScoringConfig(viewer, params.id, body);
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
            ? 'This audit has been signed off and can no longer be rescored.'
            : result.reason === 'forbidden'
              ? 'You do not have permission to configure audit scoring.'
              : 'Audit not found.'),
        issues: result.issues,
      },
      { status },
    );
  }

  return NextResponse.json({ ok: true });
}
