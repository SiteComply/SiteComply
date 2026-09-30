import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { transcriptForViewer } from '@/services/inductionVideo/narrationService';
import { streamMedia } from '@/services/inductionVideo/mediaResponse';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/induction-video/[videoId]/transcript
 *
 * The Admin Centre's copy of the platform route beside it, differing only in which
 * realm the actor comes from — the same shape as every other paired route here.
 *
 * ── WHY IT DID NOT EXIST ──────────────────────────────────────────────────
 *
 * The shared review panels hard-coded `/api/platform/...` for the transcript, the
 * subtitles and the rendered video while correctly using `apiBase` for every action.
 * So an Admin Centre OWNER could approve, narrate, render and publish a video and
 * never watch or read it: those three requests needed a PLATFORM session and returned
 * 401. The panels now use `apiBase`, which makes these routes necessary rather than
 * merely symmetrical.
 *
 * Open to any signed-in admin, VIEWER included: reading what an induction says is
 * exactly what a read-only role is for. `transcriptForViewer` re-checks.
 */
export async function GET(req: NextRequest, { params }: { params: { videoId: string } }) {
  const admin = getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const file = await transcriptForViewer(videoActorFromAdmin(admin), params.videoId);
  if (!file) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  return streamMedia(req, file.blobPath, {
    contentType: 'text/plain; charset=utf-8',
    fileName: file.fileName,
    download: true,
  });
}
