import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { withClosedProjectHandling } from '@/lib/routeErrors';
import {
  createRevision,
  issueRevision,
  discardDraftRevision,
} from '@/services/sites/cppRevisionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CPP document control Phase A — revision actions.
 *
 *   POST body { action: 'create' }                      -> snapshot as a new draft
 *   POST body { action: 'issue',   revisionId, signature, note? }
 *                                                       -> approve and issue it
 *   POST body { action: 'discard', revisionId }         -> delete an UNISSUED draft
 *
 * One route with an explicit action rather than three, because all three are
 * lifecycle transitions on the same object and the permission split lives in the
 * service — `create` and `discard` follow `sites:edit`, `issue` is Director-only.
 * There is deliberately no verb that edits an existing snapshot: a mistake is
 * corrected by issuing a new revision, which is what document control means.
 */
async function POSTHandler(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  let body: {
    action?: string;
    revisionId?: string;
    note?: string | null;
    /** Required for `issue` — approving and issuing are one act. */
    signature?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result =
    body.action === 'create'
      ? await createRevision(viewer, params.id)
      : body.action === 'issue'
        ? body.revisionId
          ? await issueRevision(
              viewer,
              params.id,
              body.revisionId,
              body.note ?? null,
              body.signature,
            )
          : ({ ok: false, error: 'No revision given.' } as const)
        : body.action === 'discard'
          ? body.revisionId
            ? await discardDraftRevision(viewer, params.id, body.revisionId)
            : ({ ok: false, error: 'No revision given.' } as const)
          : ({ ok: false, error: 'Unknown action.' } as const);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

export const POST = withClosedProjectHandling(POSTHandler);
