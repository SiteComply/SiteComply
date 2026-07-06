import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateAction,
  updateAction,
  deleteAction,
  type ActionInput,
} from '@/services/actions/actionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/actions/[id]
 * Update an action. Enforces the actions "edit" permission and the
 * Assigned-Sites boundary (existing + target site must be in scope).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'actions', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to edit actions.' },
      { status: 403 },
    );
  }

  let body: ActionInput;
  try {
    body = (await req.json()) as ActionInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = validateAction(body, viewer);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  const updated = await updateAction(
    viewer,
    params.id,
    result.value,
    (body as { completionNote?: string }).completionNote,
  );
  if (!updated.ok) {
    if (updated.reason === 'note_required') {
      return NextResponse.json(
        { ok: false, errors: { completionNote: 'A completion note is required to mark this action Completed.' } },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, error: 'Action not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: updated.id });
}

/**
 * DELETE /api/platform/actions/[id]
 * Permanently delete an action. Enforces the actions "edit" permission (managing
 * = editing) and the Assigned-Sites boundary (the action must be in scope). Any
 * audit finding it was raised from is left intact.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'actions', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to delete actions.' },
      { status: 403 },
    );
  }

  const deleted = await deleteAction(viewer, params.id);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: 'Action not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
