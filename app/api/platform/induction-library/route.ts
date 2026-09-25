import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { moduleActorFromPlatformViewer } from '@/services/inductionModules/moduleActor';
import { handleLibraryAction } from '@/services/inductionVideo/libraryActions';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The video library, from the Platform.
 *
 * Authenticates and nothing else; every action lives in `handleLibraryAction`,
 * shared verbatim with the Admin Centre route.
 */
async function POSTHandler(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, payload } = await handleLibraryAction(
    moduleActorFromPlatformViewer(viewer),
    body,
  );
  return NextResponse.json(payload, { status });
}

export const POST = withClosedProjectHandling(POSTHandler);
