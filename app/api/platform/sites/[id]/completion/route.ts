import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { buildClosureChecklist } from '@/services/projectClosure/closureChecklist';
import {
  closeProject,
  reopenProject,
  canCloseProject,
  canReopenProject,
} from '@/services/projectClosure/closureService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SC-025 — project completion.
 *
 * GET    the live completion checklist
 * POST   close the project (Site Manager or Director)
 * DELETE reopen it (Director only, reason required)
 *
 * The checklist is rebuilt inside `closeProject` regardless of what GET
 * returned: a browser that saw a clean checklist minutes ago is not evidence
 * that the site is clear now.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  if (!viewer.siteIds.includes(params.id))
    return NextResponse.json(
      { ok: false, error: 'Project not found.' },
      { status: 404 },
    );

  const checklist = await buildClosureChecklist(params.id);
  return NextResponse.json({
    ok: true,
    checklist,
    canClose: canCloseProject(viewer.role),
    canReopen: canReopenProject(viewer.role),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );

  let body: { reason?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body is fine — the closure reason is optional */
  }

  const result = await closeProject(viewer, params.id, {
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      suspendedAssignments: result.suspendedAssignments,
      warnings: result.warnings,
    });
  }

  if (result.reason === 'blocked') {
    return NextResponse.json(
      {
        ok: false,
        error: 'This project cannot be completed yet.',
        checklist: result.checklist,
      },
      { status: 409 },
    );
  }
  const status =
    result.reason === 'forbidden'
      ? 403
      : result.reason === 'not_found'
        ? 404
        : 409;
  const error =
    result.reason === 'forbidden'
      ? 'Only Site Managers and Directors can complete a project.'
      : result.reason === 'already_closed'
        ? 'This project is already completed.'
        : 'Project not found.';
  return NextResponse.json({ ok: false, error }, { status });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );

  let body: { reason?: unknown; restoreAssignments?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* handled by the reason check below */
  }

  const result = await reopenProject(viewer, params.id, {
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    restoreAssignments: body.restoreAssignments !== false,
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      restoredAssignments: result.restoredAssignments,
    });
  }

  const status =
    result.reason === 'forbidden'
      ? 403
      : result.reason === 'not_found'
        ? 404
        : 400;
  const error =
    result.reason === 'forbidden'
      ? 'Only Directors can reopen a completed project.'
      : result.reason === 'reason_required'
        ? 'Enter a reason for reopening this project.'
        : result.reason === 'not_closed'
          ? 'This project is not completed.'
          : 'Project not found.';
  return NextResponse.json({ ok: false, error }, { status });
}
