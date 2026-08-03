import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { createShare, listShares } from '@/services/closeOut/closeOutSharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 3 — share links for one pack revision.
 *
 * GET lists them (never returning a token). POST creates one and returns the
 * token EXACTLY ONCE — only its hash is stored, so it cannot be shown again.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; packId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );

  const shares = await listShares(viewer, params.packId);
  if (!shares)
    return NextResponse.json(
      { ok: false, error: 'Pack not found.' },
      { status: 404 },
    );
  return NextResponse.json({ ok: true, shares });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; packId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );

  let body: { label?: unknown; days?: unknown; includeZip?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await createShare(viewer, params.packId, {
    label: typeof body.label === 'string' ? body.label : undefined,
    days: typeof body.days === 'number' ? body.days : undefined,
    includeZip: body.includeZip === true,
  });

  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    const error =
      result.reason === 'invalid'
        ? 'Enter who the link is for, and choose a valid expiry.'
        : result.reason === 'forbidden'
          ? 'You cannot share close-out packs.'
          : 'Pack not found.';
    return NextResponse.json({ ok: false, error }, { status });
  }

  // The absolute URL is built here so the client never has to guess the host.
  const origin = req.nextUrl.origin;
  return NextResponse.json({
    ok: true,
    id: result.share.id,
    url: `${origin}/pack/${result.share.token}`,
    expiresAt: result.share.expiresAt.toISOString(),
  });
}
