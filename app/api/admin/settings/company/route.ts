import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/company — RETIRED.
 *
 * Company profile and branding moved to Platform Settings → Company profile &
 * branding, where a Director owns them. The Admin Centre keeps a READ-ONLY view
 * as the platform operator's fallback.
 *
 * Two editors of one singleton row is the duplicate source of truth that
 * section exists to remove: a company name that disagrees with itself across
 * two screens is worse than one that cannot be edited from here.
 *
 * 409, not 403 — the caller is not forbidden, the operation has moved. The
 * route is kept rather than deleted so an older tab or a bookmarked form gets
 * this explanation instead of a 404 it cannot interpret.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        'Company profile and branding are now managed in Platform Settings → Company profile & branding. This view is read-only.',
    },
    { status: 409 },
  );
}
