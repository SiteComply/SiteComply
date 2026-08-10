import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageCompanyProfile } from '@/services/platformUsers/platformPermissions';
import { savePlatformCompanyProfile } from '@/services/company/companyConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/company-profile
 *
 * Director-only. The page renders a Project Manager's controls disabled, but
 * that is a courtesy — THIS is the permission. A disabled input is a suggestion
 * to a browser; the gate has to be here or it is not a gate.
 */
export async function PATCH(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!canManageCompanyProfile(viewer.role)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Only Directors can change company profile and branding.',
      },
      { status: 403 },
    );
  }

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
  // Only a real boolean counts. `v !== false` turned an ABSENT toggle into
  // `true`, so a request that never mentioned the close-out pack defaults
  // silently switched all four back on — the same absent-means-blank fault as
  // the text fields, and it has to be fixed here too or the service never
  // learns the field was missing.
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

  const result = await savePlatformCompanyProfile(
    {
      companyName: str(body.companyName),
      registrationNumber: str(body.registrationNumber),
      vatNumber: str(body.vatNumber),
      primaryContactName: str(body.primaryContactName),
      primaryEmail: str(body.primaryEmail),
      primaryPhone: str(body.primaryPhone),
      website: str(body.website),
      addressLine1: str(body.addressLine1),
      addressLine2: str(body.addressLine2),
      addressTown: str(body.addressTown),
      addressPostcode: str(body.addressPostcode),
      tagline: str(body.tagline),
      primaryColor: str(body.primaryColor),
      accentColor: str(body.accentColor),
      disclaimer: str(body.disclaimer),
      reportFooter: str(body.reportFooter),
      packIncludeCompanyInfo: bool(body.packIncludeCompanyInfo),
      packIncludeLogo: bool(body.packIncludeLogo),
      packIncludePrintLogo: bool(body.packIncludePrintLogo),
      packIncludeStandardDetails: bool(body.packIncludeStandardDetails),
    },
    { userId: viewer.id, name: viewer.name },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
