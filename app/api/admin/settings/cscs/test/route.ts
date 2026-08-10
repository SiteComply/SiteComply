import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { resolveCscsTestCredentials } from '@/services/cscs/cscsConfigService';
import { testSmartCheckConnection } from '@/services/cscs/smartCheckConnectionTest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/cscs/test
 *
 * Run a CSCS Smart Check connection test. Admin write roles only.
 * Body: { smartCheckApiUrl?, smartCheckApiKey? } — form values merged over the
 * stored config, so the test works BEFORE anything is saved (a blank key means
 * "use the stored one", the same convention as the save path).
 *
 * Mirrors the SMS test route's contract: HTTP 200 whenever the test RAN, with
 * the outcome in the body; 400/401 only when the request itself was bad. A
 * failed connection is a successful test, and a route that returned 500 for it
 * would make the browser's error handling fight the diagnostic.
 *
 * Changes nothing. No configuration is written, no verification is recorded,
 * and no worker or card is involved.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  let body: { smartCheckApiUrl?: string; smartCheckApiKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const credentials = await resolveCscsTestCredentials({
    smartCheckApiUrl: body.smartCheckApiUrl,
    smartCheckApiKey: body.smartCheckApiKey,
  });

  const result = await testSmartCheckConnection(credentials);

  // The key is never echoed; `result` carries only the host and a classified
  // outcome. Returned wholesale so the UI renders one shape for every case.
  return NextResponse.json({ ok: result.ok, result });
}
