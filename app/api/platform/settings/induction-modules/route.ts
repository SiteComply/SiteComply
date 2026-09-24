import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  issueRevision,
  saveDraft,
  seedModuleCatalogue,
  setModuleActive,
  startDraft,
  updateModuleSettings,
} from '@/services/inductionModules/inductionModuleService';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Company induction modules — the one write endpoint.
 *
 *   POST { action: 'startDraft', moduleId }
 *   POST { action: 'saveDraft', revisionId, heading, narration }
 *   POST { action: 'issue', revisionId, issueNote }      → Director only
 *   POST { action: 'setActive', moduleId, active }       → Director only
 *   POST { action: 'settings', moduleId, mandatory?, defaultIncluded?, order? }
 *   POST { action: 'seed' }                              → Director only
 *
 * Every permission is re-checked in the service, so this route only routes.
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
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const refuse = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

  switch (body.action) {
    case 'startDraft': {
      const r = await startDraft(viewer, str('moduleId'));
      return r.ok ? NextResponse.json({ ok: true, ...r.value }) : refuse(r.error);
    }
    case 'saveDraft': {
      const r = await saveDraft(viewer, str('revisionId'), {
        heading: str('heading'),
        narration: str('narration'),
      });
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.error);
    }
    case 'issue': {
      const r = await issueRevision(viewer, str('revisionId'), str('issueNote'));
      return r.ok ? NextResponse.json({ ok: true, ...r.value }) : refuse(r.error);
    }
    case 'setActive': {
      const r = await setModuleActive(viewer, str('moduleId'), body.active === true);
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.error);
    }
    case 'settings': {
      const num = (k: string) =>
        typeof body[k] === 'number' ? (body[k] as number) : undefined;
      const bool = (k: string) =>
        typeof body[k] === 'boolean' ? (body[k] as boolean) : undefined;
      const r = await updateModuleSettings(viewer, str('moduleId'), {
        mandatory: bool('mandatory'),
        defaultIncluded: bool('defaultIncluded'),
        order: num('order'),
      });
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.error);
    }
    case 'seed': {
      /*
       * Creating the starter set is a Director's act even though it writes only
       * DRAFTS: it decides which topics this company briefs on, which is
       * organisational policy rather than a convenience.
       */
      if (viewer.role !== 'DIRECTOR') {
        return refuse('Only a Director may create the starter modules.');
      }
      const result = await seedModuleCatalogue(viewer.name);
      return NextResponse.json({ ok: true, ...result });
    }
    default:
      return refuse('Unknown action.');
  }
}

export const POST = withClosedProjectHandling(POSTHandler);
