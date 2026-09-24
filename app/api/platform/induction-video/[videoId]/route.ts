import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  approveScript,
  editScene,
  getVideo,
  removeScene,
  supersedeEarlierVersions,
} from '@/services/inductionVideo/inductionVideoService';
import { requestNarration } from '@/services/inductionVideo/narrationService';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One version of an induction video.
 *
 *   GET                                     → scenes, history, staleness
 *   PATCH { action: 'editScene', sceneId, narration }
 *   PATCH { action: 'removeScene', sceneId }   → optional scenes only
 *   PATCH { action: 'approve' }                → Director or Site Manager
 *   PATCH { action: 'narrate' }                → queue narration of an approved
 *                                                script; the scheduler runs it
 */
async function GETHandler(_req: NextRequest, { params }: { params: { videoId: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });
  const detail = await getVideo(viewer, params.videoId);
  if (!detail) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...detail });
}

async function PATCHHandler(req: NextRequest, { params }: { params: { videoId: string } }) {
  const viewer = await getPlatformViewer();
  if (!viewer) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');

  switch (body.action) {
    case 'editScene': {
      const r = await editScene(viewer, str('sceneId'), str('narration'));
      return r.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    case 'removeScene': {
      const r = await removeScene(viewer, str('sceneId'));
      return r.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    case 'approve': {
      const r = await approveScript(viewer, params.videoId);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      // Approval makes this the current version; the rest become history and
      // are kept, never deleted.
      const detail = await getVideo(viewer, params.videoId);
      if (detail) {
        await supersedeEarlierVersions(detail.video.jobSiteId, params.videoId, viewer.name);
      }
      return NextResponse.json({ ok: true });
    }
    case 'narrate': {
      const r = await requestNarration(viewer, params.videoId);
      return r.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    default:
      return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }
}

export const GET = withClosedProjectHandling(GETHandler);
export const PATCH = withClosedProjectHandling(PATCHHandler);
