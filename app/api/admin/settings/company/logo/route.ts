import { NextResponse } from 'next/server';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST / DELETE /api/admin/settings/company/logo — RETIRED.
 *
 * Logo management moved to Platform Settings → Company profile & branding,
 * which now handles BOTH the screen logo and the print logo. See the sibling
 * route for why the Admin Centre no longer writes this row.
 *
 * The public serving routes (/api/company/logo, /api/company/print-logo) are
 * unaffected — they only read.
 */
const MOVED = NextResponse.json(
  {
    ok: false,
    error:
      'Company logos are now managed in Platform Settings → Company profile & branding. This view is read-only.',
  },
  { status: 409 },
);

async function POSTHandler() {
  return MOVED.clone();
}

async function DELETEHandler() {
  return MOVED.clone();
}

export const POST = withClosedProjectHandling(POSTHandler);
export const DELETE = withClosedProjectHandling(DELETEHandler);
