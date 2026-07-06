import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  saveCompanyConfig,
  type SaveCompanyConfigInput,
} from '@/services/company/companyConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/company
 * Save the company profile + branding text fields. Admin-only. Body:
 *   { companyName, supportEmail, supportPhone, primaryColor, accentColor, tagline }
 * The logo is managed separately via /company/logo.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  let body: SaveCompanyConfigInput;
  try {
    body = (await req.json()) as SaveCompanyConfigInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = await saveCompanyConfig(body, { adminId: admin.adminId, name: admin.name });
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
