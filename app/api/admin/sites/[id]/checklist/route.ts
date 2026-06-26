import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { getSiteById } from '@/services/sites/adminSiteService';
import {
  validateChecklistItems,
  saveChecklist,
} from '@/services/checklists/adminChecklistService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sites/[id]/checklist
 * Body: { items: ChecklistItemInput[] }
 * Saves the site's induction checklist, versioning it if needed. Admin only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const admin = getAdminSession();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  const site = await getSiteById(params.id);
  if (!site) {
    return NextResponse.json(
      { ok: false, error: 'Site not found.' },
      { status: 404 },
    );
  }

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const validated = validateChecklistItems(
    body.items as Parameters<typeof validateChecklistItems>[0],
  );
  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, error: validated.error },
      { status: 400 },
    );
  }

  const result = await saveChecklist(params.id, validated.items);
  return NextResponse.json({ ok: true, ...result });
}
