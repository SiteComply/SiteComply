import { NextResponse } from 'next/server';
import { getCompanyLogo } from '@/services/company/companyConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/company/logo
 * Stream the current company logo. Public — a logo is a branding asset, not
 * sensitive — so it can be shown on the admin settings page and any future
 * branding surface. The blob container itself stays private; this route is the
 * only way the image is exposed. Returns 404 when no logo is set.
 */
export async function GET() {
  const logo = await getCompanyLogo();
  if (!logo) {
    return NextResponse.json({ ok: false, error: 'No logo set.' }, { status: 404 });
  }
  return new NextResponse(logo.bytes, {
    status: 200,
    headers: {
      'Content-Type': logo.contentType,
      'Content-Length': String(logo.bytes.length),
      // Short cache; the admin UI cache-busts with a version query param on change.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
