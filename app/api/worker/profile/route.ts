import { NextRequest, NextResponse } from 'next/server';
import { CscsCardType } from '@prisma/client';
import {
  getWorkerSession,
  createWorkerSessionToken,
  setWorkerSessionCookie,
} from '@/lib/session';
import { upsertWorkerProfile } from '@/services/workers/workerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProfileBody {
  fullName?: string;
  company?: string;
  cscsCardNumber?: string;
  cscsCardType?: string;
  cscsExpiry?: string; // ISO date (YYYY-MM-DD) from the date input
}

/**
 * POST /api/worker/profile
 * Saves the verified worker's name/company (and optional CSCS card), then
 * refreshes the session cookie so it carries the workerId. Requires a valid
 * worker session from the SMS step.
 */
export async function POST(req: NextRequest) {
  const session = getWorkerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Your session has expired. Please verify again.' },
      { status: 401 },
    );
  }

  let body: ProfileBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const fullName = (body.fullName ?? '').trim();
  const company = (body.company ?? '').trim();
  if (fullName.length < 2) {
    return NextResponse.json(
      { ok: false, error: 'Please enter your full name.' },
      { status: 400 },
    );
  }
  if (company.length < 2) {
    return NextResponse.json(
      { ok: false, error: 'Please enter your company name.' },
      { status: 400 },
    );
  }

  // Optional CSCS card validation.
  let cscsCardType: CscsCardType | null = null;
  if (body.cscsCardType) {
    if (!(body.cscsCardType in CscsCardType)) {
      return NextResponse.json(
        { ok: false, error: 'Unrecognised CSCS card type.' },
        { status: 400 },
      );
    }
    cscsCardType = body.cscsCardType as CscsCardType;
  }

  let cscsExpiry: Date | null = null;
  if (body.cscsExpiry) {
    const d = new Date(body.cscsExpiry);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { ok: false, error: 'Enter a valid CSCS card expiry date.' },
        { status: 400 },
      );
    }
    cscsExpiry = d;
  }

  const worker = await upsertWorkerProfile(session.mobile, {
    fullName,
    company,
    cscsCardNumber: body.cscsCardNumber,
    cscsCardType,
    cscsExpiry,
  });

  // Refresh the session so it now carries the workerId.
  setWorkerSessionCookie(
    createWorkerSessionToken({ mobile: session.mobile, workerId: worker.id }),
  );

  return NextResponse.json({
    ok: true,
    worker: { fullName: worker.fullName, company: worker.company },
  });
}
