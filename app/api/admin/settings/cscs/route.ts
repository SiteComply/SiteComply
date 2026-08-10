import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { saveCscsConfig } from '@/services/cscs/cscsConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/cscs — SC-001 Smart Check configuration.
 *
 * Admin-write roles only. The API key is written encrypted by the service and
 * is never returned by any read path; a blank key means "keep the stored one",
 * the same convention the SMS integration uses.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const result = await saveCscsConfig(
    {
      activeProvider: str(body.activeProvider),
      verificationEnabled: body.verificationEnabled !== false,
      smartCheckApiUrl: str(body.smartCheckApiUrl),
      smartCheckApiKey: str(body.smartCheckApiKey),
    },
    { adminId: auth.admin.adminId, name: auth.admin.name },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
