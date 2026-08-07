import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageCompanyProfile } from '@/services/platformUsers/platformPermissions';
import {
  validateLogoFile,
  setPlatformCompanyLogo,
  clearPlatformCompanyLogo,
  type CompanyLogoKind,
} from '@/services/company/companyConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST / DELETE /api/platform/company-profile/logo?kind=screen|print
 *
 * Director-only upload and removal for both logos. Reuses validateLogoFile, so
 * the same size cap and the same accepted types apply as the Admin Centre
 * enforced — including the deliberate exclusion of SVG, which can carry scripts
 * and would be a stored-XSS vector on a publicly served logo route.
 */
function kindOf(req: NextRequest): CompanyLogoKind | null {
  const raw = req.nextUrl.searchParams.get('kind');
  return raw === 'print' ? 'print' : raw === 'screen' ? 'screen' : null;
}

async function gate(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer)
    return {
      err: NextResponse.json(
        { ok: false, error: 'Not signed in.' },
        { status: 401 },
      ),
    };
  if (!canManageCompanyProfile(viewer.role))
    return {
      err: NextResponse.json(
        { ok: false, error: 'Only Directors can change company branding.' },
        { status: 403 },
      ),
    };
  const kind = kindOf(req);
  if (!kind)
    return {
      err: NextResponse.json(
        { ok: false, error: 'Specify which logo.' },
        { status: 400 },
      ),
    };
  return { viewer, kind };
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if ('err' in g) return g.err;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: 'Please choose an image to upload.' },
      { status: 400 },
    );
  }
  const check = validateLogoFile({ size: file.size, type: file.type });
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: 400 });
  }

  await setPlatformCompanyLogo(
    g.kind,
    {
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type,
    },
    { userId: g.viewer.id, name: g.viewer.name },
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const g = await gate(req);
  if ('err' in g) return g.err;
  await clearPlatformCompanyLogo(g.kind, {
    userId: g.viewer.id,
    name: g.viewer.name,
  });
  return NextResponse.json({ ok: true });
}
