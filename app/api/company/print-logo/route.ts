import { NextResponse } from 'next/server';
import { getCompanyPrintLogo } from '@/services/company/companyConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/company/print-logo
 * Stream the current PRINT logo — the mono/high-contrast mark used on generated
 * documents, where a full-colour screen logo does not reproduce. Public — a logo is a branding asset, not
 * sensitive — so it can be shown on the admin settings page and any future
 * branding surface. The blob container itself stays private; this route is the
 * only way the image is exposed. Returns 404 when no logo is set.
 */
// Raster image types that are safe to render inline. Anything else (e.g. a legacy
// SVG stored before SVG uploads were blocked) is served as a download so it can
// never execute as a stored-XSS payload on this public route.
const INLINE_SAFE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export async function GET() {
  const logo = await getCompanyPrintLogo();
  if (!logo) {
    return NextResponse.json({ ok: false, error: 'No print logo set.' }, { status: 404 });
  }
  const inlineSafe = INLINE_SAFE_TYPES.has(logo.contentType);
  return new NextResponse(logo.bytes, {
    status: 200,
    headers: {
      'Content-Type': logo.contentType,
      'Content-Length': String(logo.bytes.length),
      // Never let the browser MIME-sniff, and force anything not known-safe to
      // download rather than render (defence-in-depth against stored XSS).
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': inlineSafe ? 'inline' : 'attachment; filename="print-logo"',
      // Short cache; the admin UI cache-busts with a version query param on change.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
