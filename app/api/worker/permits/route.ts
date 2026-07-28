import { NextRequest, NextResponse } from 'next/server';
import { getWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { createPermit } from '@/services/permits/permitService';
import type { PermitAnswers } from '@/services/permits/permitFlow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/permits (SC-009) — a checked-in worker raises a permit for the
 * site they're currently on. The site is re-derived server-side from the worker's
 * open check-in (never taken from the request), so a permit can only ever be
 * raised against a site the worker is actually on.
 */
export async function POST(req: NextRequest) {
  const context = await getWorkerContext();
  if (!context) {
    return NextResponse.json(
      { ok: false, error: 'Please check in to a site first.' },
      { status: 401 },
    );
  }

  let body: {
    permitTypeId?: string;
    workActivity?: string;
    workLocation?: string;
    proposedStart?: string;
    proposedFinish?: string;
    answers?: PermitAnswers;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (!body.permitTypeId) {
    return NextResponse.json(
      { ok: false, error: 'Please choose a permit type.' },
      { status: 400 },
    );
  }

  const result = await createPermit({
    workerId: context.worker.id,
    workerName: context.worker.fullName,
    siteId: context.activeSiteId,
    permitTypeId: body.permitTypeId,
    workActivity: body.workActivity ?? '',
    workLocation: body.workLocation ?? null,
    proposedStart: body.proposedStart ?? null,
    proposedFinish: body.proposedFinish ?? null,
    answers: body.answers ?? {},
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
