import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Lightweight liveness probe for Azure App Service health checks. Deliberately
 * does not touch the database, so a transient DB blip doesn't cycle instances.
 */
export function GET() {
  return NextResponse.json({ status: 'ok', service: 'sitecomply' });
}
