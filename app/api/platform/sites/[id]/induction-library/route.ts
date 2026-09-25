import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canWorkOnVideoSite } from '@/services/inductionVideo/inductionVideoService';
import { moduleActorFromPlatformViewer } from '@/services/inductionModules/moduleActor';
import {
  setSiteLibraryDecision,
  type SiteLibraryInput,
} from '@/services/inductionVideo/libraryAssetService';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What one project has decided about a company video. */
async function POSTHandler(req: NextRequest, { params }: { params: { id: string } }) {
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
  const input: SiteLibraryInput =
    body.state === 'EXCLUDED'
      ? { state: 'EXCLUDED', reason: str('reason') }
      : body.state === 'INCLUDED'
        ? { state: 'INCLUDED' }
        : { state: 'DEFAULT' };

  const r = await setSiteLibraryDecision(
    moduleActorFromPlatformViewer(viewer),
    params.id,
    str('assetId'),
    input,
  );
  return r.ok
    ? NextResponse.json({ ok: true, ...r.value })
    : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
}

export const POST = withClosedProjectHandling(POSTHandler);
