import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { getAdminSession } from '@/lib/session';
import { getVideo } from '@/services/inductionVideo/inductionVideoService';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';
import { handleVideoAction } from '@/services/inductionVideo/videoActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One version of an induction video, from the Admin Centre.
 *
 * Identical actions on identical data, through the same dispatcher and the same
 * services. The only difference from the Platform route is that authority and
 * site scope come from an AdminRole instead of a PlatformRole — an Admin Centre
 * OWNER or ADMIN has authority equivalent to a Platform Director, across every
 * project.
 *
 * GET is open to any signed-in admin, including VIEWER: reading the state of a
 * project's induction video is what the read-only role is for. PATCH requires a
 * write role, and the service refuses a VIEWER again regardless.
 */
async function GETHandler(_req: NextRequest, { params }: { params: { videoId: string } }) {
  const admin = getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const detail = await getVideo(videoActorFromAdmin(admin), params.videoId);
  if (!detail) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...detail });
}

async function PATCHHandler(req: NextRequest, { params }: { params: { videoId: string } }) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const { status, payload } = await handleVideoAction(
    videoActorFromAdmin(auth.admin),
    params.videoId,
    body,
  );
  return NextResponse.json(payload, { status });
}

export const GET = GETHandler;
export const PATCH = PATCHHandler;
