import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { completeAttempt } from '@/services/knowledgeChecks/attemptService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/knowledge-check/complete
 * Body: { attemptId }
 * Marks the attempt PASSED only when every sampled question's latest answer is
 * correct (re-checked server-side). Otherwise returns the still-incorrect ids.
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
      { status: 401 },
    );
  }

  let body: { attemptId?: string };
  try {
    body = (await req.json()) as { attemptId?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (!body.attemptId) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await completeAttempt(worker.id, body.attemptId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: 'Attempt not found.' },
      { status: 404 },
    );
  }
  return NextResponse.json(result);
}
