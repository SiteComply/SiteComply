import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  getStandardArrangements,
  saveStandardArrangement,
} from '@/services/sites/arrangementService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CPP Tier 3A — COMPANY-level management arrangements.
 *
 *   GET -> { arrangements: { KEY: text|null } }
 *   PUT    body { key, content }   (content null clears it)
 *
 * Organisational policy applying to every project, so the write is Director-only
 * — enforced in the service, not merely here. A blank content clears the row
 * rather than storing an empty string: "not recorded" is one state.
 */
export async function GET() {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, arrangements: await getStandardArrangements() });
}

export async function PUT(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  let body: { key?: string; content?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  if (!body.key) {
    return NextResponse.json({ ok: false, error: 'No arrangement given.' }, { status: 400 });
  }
  const result = await saveStandardArrangement(viewer, body.key, body.content ?? null);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 403 });
  }
  return NextResponse.json({ ok: true, arrangements: await getStandardArrangements() });
}
