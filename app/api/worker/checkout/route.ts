import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { checkOut } from '@/services/submissions/submissionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/checkout
 * Body: { submissionId: string }
 * Marks the worker's own open check-in as checked out (sets checkedOutAt).
 */
export async function POST(req: NextRequest) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired.' },
      { status: 401 },
    );
  }

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) {
    return NextResponse.json(
      { ok: false, error: 'Worker not found.' },
      { status: 400 },
    );
  }

  let body: { submissionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (!body.submissionId) {
    return NextResponse.json(
      { ok: false, error: 'No check-in specified.' },
      { status: 400 },
    );
  }

  const done = await checkOut(body.submissionId, worker.id);
  if (!done) {
    return NextResponse.json(
      {
        ok: false,
        error: 'You’re already checked out, or this isn’t your check-in.',
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
