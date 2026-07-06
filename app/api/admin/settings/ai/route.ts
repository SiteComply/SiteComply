import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { saveAiConfig, type SaveAiConfigInput } from '@/services/ai/aiConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/ai
 * Save the AI provider + feature configuration. Admin-only. Body:
 *   { enabled, activeProvider, settings: { [providerId]: { [field]: value } },
 *     allowedRoles, dailyPerUser, monthlyGlobal }
 * Secret fields left blank keep their stored (encrypted) value. Enabling the
 * feature requires the active provider's required fields to be present.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  let body: SaveAiConfigInput;
  try {
    body = (await req.json()) as SaveAiConfigInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = await saveAiConfig(body, {
    adminId: admin.adminId,
    name: admin.name,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, errors: result.errors },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
