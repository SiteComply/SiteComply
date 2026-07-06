import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import {
  validateLogoFile,
  setCompanyLogo,
  clearCompanyLogo,
} from '@/services/company/companyConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/company/logo
 * Multipart upload of the company logo. Admin-only. The image is stored in the
 * existing private blob container (branding/ prefix); the company config points
 * at it. Any previous logo blob is cleaned up.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid upload.' }, { status: 400 });
  }

  const entry = form.get('file');
  const file = entry instanceof File ? entry : null;
  const check = validateLogoFile(file ? { size: file.size, type: file.type } : null);
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: 400 });
  }

  const buffer = Buffer.from(await file!.arrayBuffer());
  await setCompanyLogo(
    { buffer, fileName: file!.name || 'logo', mimeType: file!.type },
    { adminId: admin.adminId, name: admin.name },
  );
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/settings/company/logo
 * Remove the company logo (delete the blob + clear the pointer). Admin-only.
 */
export async function DELETE() {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  const admin = auth.admin;
  await clearCompanyLogo({ adminId: admin.adminId, name: admin.name });
  return NextResponse.json({ ok: true });
}
