import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { revokeShare } from '@/services/closeOut/closeOutSharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SC-024 Phase 3 — revoke a share link.
 *
 * Revocation is the reason share tokens are stored at all: a stateless signed
 * token could not be withdrawn before its expiry.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; packId: string; shareId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );

  const ok = await revokeShare(viewer, params.shareId);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json(
        { ok: false, error: 'Link not found.' },
        { status: 404 },
      );
}
