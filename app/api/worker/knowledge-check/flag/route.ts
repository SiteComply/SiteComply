import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { flagQuestion } from '@/services/knowledgeChecks/attemptService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/knowledge-check/flag
 * Body: { attemptId, questionId, reason? }
 * Records the mockup's "Flag question" for manager review / quality reporting.
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

  let body: { attemptId?: string; questionId?: string; reason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (!body.attemptId || !body.questionId) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const ok = await flagQuestion(
    worker.id,
    body.attemptId,
    body.questionId,
    body.reason,
  );
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: 'Could not flag that question.' },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
