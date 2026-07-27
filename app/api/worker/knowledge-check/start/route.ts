import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession } from '@/lib/session';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { startAttempt } from '@/services/knowledgeChecks/attemptService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/knowledge-check/start
 * Body: { siteId: string }
 *
 * Starts (or resumes) the worker's knowledge check for a site during induction.
 * The worker is not yet checked in, so the site is taken from the body and the
 * worker is identified from their SMS session. Never returns correct answers.
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
      { ok: false, error: 'Please complete your details first.' },
      { status: 400 },
    );
  }

  let body: { siteId?: string };
  try {
    body = (await req.json()) as { siteId?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (!body.siteId) {
    return NextResponse.json(
      { ok: false, error: 'No site specified.' },
      { status: 400 },
    );
  }

  const result = await startAttempt(worker.id, body.siteId);
  return NextResponse.json({ ok: true, ...result });
}
