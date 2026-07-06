import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
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
  const admin = getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

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
