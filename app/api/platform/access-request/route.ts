import { NextRequest, NextResponse } from 'next/server';
import {
  validateAccessRequest,
  createAccessRequest,
  type AccessRequestInput,
} from '@/services/accessRequests/accessRequestService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/access-request  (public)
 * Submits a self-service Platform Access Request. Validates the fields and
 * prevents duplicates (existing Platform User or existing pending request).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = validateAccessRequest((body ?? {}) as AccessRequestInput);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 400 },
    );
  }

  const created = await createAccessRequest(result.value);
  if (!created.ok) {
    const error =
      created.reason === 'exists_user'
        ? 'An account already exists for these details — please sign in instead.'
        : 'A request is already pending for these details. An administrator will be in touch.';
    return NextResponse.json({ ok: false, error }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
