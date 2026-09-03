import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession, setActiveWorkerSiteCookie } from '@/lib/session';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/active-site
 * Body: { siteId: string }
 *
 * Switches which checked-into site the Worker Dashboard shows (SC-004). The
 * siteId is accepted ONLY if the worker currently holds an open check-in there —
 * so this can never be used to view a site the worker isn't on. On success it
 * sets the (non-authoritative) active-site cookie; getWorkerContext re-validates
 * it on every request regardless.
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

  let body: { siteId?: string };
  try {
    body = (await req.json()) as { siteId?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  const siteId = (body.siteId ?? '').trim();
  if (!siteId) {
    return NextResponse.json(
      { ok: false, error: 'No site specified.' },
      { status: 400 },
    );
  }

  // The worker must currently be checked into this site.
  const openHere = await prisma.submission.findFirst({
    where: { workerId: worker.id, jobSiteId: siteId, checkedOutAt: null },
    select: { id: true },
  });
  if (!openHere) {
    return NextResponse.json(
      { ok: false, error: 'You’re not checked into that site.' },
      { status: 404 },
    );
  }

  // The active-site cookie tracks the session lifetime, so it must not
  // outlive or under-live the session it belongs to.
  const { workerSessionTtlSeconds } = await getAuthRuntimeConfig();
  setActiveWorkerSiteCookie(siteId, workerSessionTtlSeconds);
  return NextResponse.json({ ok: true });
}
