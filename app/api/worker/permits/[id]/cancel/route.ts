import { NextRequest, NextResponse } from 'next/server';
import { getWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { cancelWorkerPermit } from '@/services/permits/permitService';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/permits/[id]/cancel (SC-009) — a worker withdraws their own
 * permit. Ownership is enforced in the service (the permit must belong to this
 * worker) and only while it is still cancellable.
 */
async function POSTHandler(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const context = await getWorkerContext();
  if (!context) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired.' },
      { status: 401 },
    );
  }
  const result = await cancelWorkerPermit(
    context.worker.id,
    context.worker.fullName,
    params.id,
  );
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}

export const POST = withClosedProjectHandling(POSTHandler);
