import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { answerQuestion } from '@/services/knowledgeChecks/attemptService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/knowledge-check/answer
 * Body: { attemptId, questionId, optionId }
 * Grades one answer server-side. Returns { correct } (+ explanation once correct)
 * but never the correct option id, so a wrong guess can't be turned into a pass.
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

  let body: { attemptId?: string; questionId?: string; optionId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (!body.attemptId || !body.questionId || !body.optionId) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await answerQuestion(
    worker.id,
    body.attemptId,
    body.questionId,
    body.optionId,
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: 'That answer could not be recorded.' },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    correct: result.correct,
    explanation: result.explanation,
  });
}
