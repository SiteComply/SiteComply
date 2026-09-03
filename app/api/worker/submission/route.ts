import { NextRequest, NextResponse } from 'next/server';
import { getWorkerSession, setActiveWorkerSiteCookie } from '@/lib/session';
import { getAuthRuntimeConfig } from '@/services/auth/authConfigService';
import { getWorkerByMobile } from '@/services/workers/workerService';
import { createCheckIn } from '@/services/submissions/submissionService';
import { parseLocationFix } from '@/services/geo/geoValidationService';
import { parseSignatureInput } from '@/services/inductionSignature/signatureService';
import type { InductionAnswers } from '@/services/checklists/inductionFlow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SubmissionBody {
  siteId?: string;
  answers?: InductionAnswers;
  gdprConsent?: boolean;
  location?: unknown; // SC-007 location fix (validated server-side)
  signature?: unknown; // SC-011 induction signature (validated server-side)
}

/**
 * POST /api/worker/submission
 * Records a compliant site check-in after re-validating the induction
 * server-side. Returns the submission id and a human-friendly reference.
 */
export async function POST(req: NextRequest) {
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
      { ok: false, error: 'Please complete your details first.' },
      { status: 400 },
    );
  }

  let body: SubmissionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (!body.siteId) {
    return NextResponse.json(
      { ok: false, error: 'No site selected.' },
      { status: 400 },
    );
  }

  const result = await createCheckIn({
    workerId: worker.id,
    siteId: body.siteId,
    answers: body.answers ?? {},
    gdprConsent: Boolean(body.gdprConsent),
    location: parseLocationFix(body.location),
    signature: parseSignatureInput(body.signature),
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  // Make the site just checked into the active one, so landing on the dashboard
  // (SC-004) shows this site even if the worker is checked into others.
  // The active-site cookie tracks the session lifetime, so it must not
  // outlive or under-live the session it belongs to.
  const { workerSessionTtlSeconds } = await getAuthRuntimeConfig();
  setActiveWorkerSiteCookie(body.siteId, workerSessionTtlSeconds);

  return NextResponse.json(result);
}
