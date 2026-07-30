import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  createSchedule,
  setScheduleActive,
  type ScheduleInput,
} from '@/services/compliance/scheduleService';

export const dynamic = 'force-dynamic';

/**
 * SC-020 Phase 1 — create a recurring compliance schedule (POST) or pause/resume
 * one (PATCH). Authorisation and site scoping live in the service; managing
 * requires audits create/edit, which Site Managers and Directors already hold, so
 * no RBAC matrix change was needed.
 */
export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  let body: ScheduleInput;
  try {
    body = (await req.json()) as ScheduleInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await createSchedule(viewer, body);
  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    return NextResponse.json(
      {
        ok: false,
        error:
          result.error ??
          (result.reason === 'forbidden'
            ? 'You do not have permission to schedule compliance activities.'
            : 'Site not found.'),
      },
      { status },
    );
  }
  return NextResponse.json({ ok: true, id: result.id });
}

export async function PATCH(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  let body: { scheduleId?: string; active?: boolean };
  try {
    body = (await req.json()) as { scheduleId?: string; active?: boolean };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (!body.scheduleId || typeof body.active !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await setScheduleActive(viewer, body.scheduleId, body.active);
  if (!result.ok) {
    const status = result.reason === 'forbidden' ? 403 : 404;
    return NextResponse.json(
      { ok: false, error: 'Schedule not found.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}
