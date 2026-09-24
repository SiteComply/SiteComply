import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { moduleActorFromPlatformViewer } from '@/services/inductionModules/moduleActor';
import { handleModuleAction } from '@/services/inductionModules/moduleActions';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Company induction modules, from Induction Videos (a Platform user).
 *
 * This route authenticates and nothing else. Every action, and every rule about
 * it, lives in `handleModuleAction` — shared verbatim with the Admin Centre
 * route, so the two front doors cannot drift into two workflows.
 *
 * Actions: startDraft · saveDraft · issue · setActive · settings · seed.
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

  const { status, payload } = await handleModuleAction(
    moduleActorFromPlatformViewer(viewer),
    body,
  );
  return NextResponse.json(payload, { status });
}

export const POST = withClosedProjectHandling(POSTHandler);
