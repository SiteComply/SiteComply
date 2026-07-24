import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { acknowledgeBulletin } from '@/services/bulletins/bulletinService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/bulletins/[id]/ack
 * Records the authenticated worker's "I've read this" acknowledgement of a Daily
 * Bulletin (SC-002). Idempotent. Requires a valid worker session.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired. Please verify again.' },
      { status: 401 },
    );
  }

  const worker = await getWorkerByMobile(session.mobile);
  if (!worker) {
    return NextResponse.json(
      { ok: false, error: 'Worker not found.' },
      { status: 401 },
    );
  }

  const ok = await acknowledgeBulletin(params.id, worker.id);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: 'Bulletin not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
