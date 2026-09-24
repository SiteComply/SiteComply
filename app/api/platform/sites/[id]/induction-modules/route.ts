import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canWorkOnVideoSite } from '@/services/inductionVideo/inductionVideoService';
import {
  setSiteModuleDecision,
  type SiteModuleInput,
} from '@/services/inductionModules/inductionModuleService';
import { moduleActorFromPlatformViewer } from '@/services/inductionModules/moduleActor';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/sites/[id]/induction-modules
 *   { moduleId, state: 'DEFAULT' | 'INCLUDED' | 'EXCLUDED' | 'OVERRIDDEN',
 *     reason?, overrideNarration? }
 *
 * What this project has decided about a company induction module. The same
 * access test the rest of the induction video uses — the right role, and this
 * project in the viewer's assigned sites — with the Director-only rule for an
 * override enforced in the service, where it cannot be routed around.
 */
async function POSTHandler(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer || !canWorkOnVideoSite(viewer, params.id)) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const moduleId = str('moduleId');
  const state = str('state');

  let input: SiteModuleInput;
  switch (state) {
    case 'DEFAULT':
      input = { state: 'DEFAULT' };
      break;
    case 'INCLUDED':
      input = { state: 'INCLUDED' };
      break;
    case 'EXCLUDED':
      input = { state: 'EXCLUDED', reason: str('reason') };
      break;
    case 'OVERRIDDEN':
      input = {
        state: 'OVERRIDDEN',
        reason: str('reason'),
        overrideNarration: str('overrideNarration'),
      };
      break;
    default:
      return NextResponse.json({ ok: false, error: 'Unknown state.' }, { status: 400 });
  }

  const result = await setSiteModuleDecision(
    moduleActorFromPlatformViewer(viewer),
    params.id,
    moduleId,
    input,
  );
  return result.ok
    ? NextResponse.json({ ok: true, ...result.value })
    : NextResponse.json({ ok: false, error: result.error }, { status: 400 });
}

export const POST = withClosedProjectHandling(POSTHandler);
