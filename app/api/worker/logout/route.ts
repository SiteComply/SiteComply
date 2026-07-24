import { NextResponse } from 'next/server';
import { clearWorkerSessionCookie } from '@/lib/session';
import { appConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/logout
 * Ends the worker session and returns to the home page.
 *
 * Signing out is NOT checking out: the worker's attendance record is untouched,
 * so anyone still on site stays on the fire register. The Worker Dashboard says
 * as much next to the button.
 */
export async function GET() {
  clearWorkerSessionCookie();
  return NextResponse.redirect(new URL('/', appConfig.baseUrl));
}
