import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  canGenerateCloseOutPack,
  createPack,
} from '@/services/closeOut/closeOutService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/sites/[id]/close-out — generate a close-out pack.
 *
 * SC-024 Phase 1. The submitted section list is re-validated in the service
 * against the caller's EFFECTIVE permissions, so a crafted request cannot make
 * a pack contain more than the person generating it may see.
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
  if (!canGenerateCloseOutPack(viewer.role)) {
    return NextResponse.json(
      { ok: false, error: 'You cannot generate close-out packs.' },
      { status: 403 },
    );
  }

  let body: { title?: unknown; preparedFor?: unknown; sections?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await createPack(viewer, params.id, {
    title: typeof body.title === 'string' ? body.title : undefined,
    preparedFor:
      typeof body.preparedFor === 'string' ? body.preparedFor : undefined,
    sections: body.sections,
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      id: result.id,
      version: result.version,
    });
  }
  const status =
    result.reason === 'forbidden'
      ? 403
      : result.reason === 'not_found'
        ? 404
        : 400;
  return NextResponse.json(
    { ok: false, error: result.error ?? 'Could not generate the pack.' },
    { status },
  );
}
