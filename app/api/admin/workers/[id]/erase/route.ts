import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { eraseWorkerPersonalData } from '@/services/workers/workerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/workers/[id]/erase
 * Erases (anonymises) a worker's personal data to honour a UK GDPR erasure
 * request. Admin only.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const result = await eraseWorkerPersonalData(params.id);
  if (!result) {
    return NextResponse.json(
      { ok: false, error: 'Worker not found.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
