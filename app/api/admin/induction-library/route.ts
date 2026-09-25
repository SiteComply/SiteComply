import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { moduleActorFromAdmin } from '@/services/inductionModules/moduleActor';
import { handleLibraryAction } from '@/services/inductionVideo/libraryActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The video library, from the Admin Centre.
 *
 * Identical actions on identical data through the same dispatcher. OWNER and ADMIN
 * manage; VIEWER is refused here and again in the service.
 */
async function POSTHandler(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, payload } = await handleLibraryAction(moduleActorFromAdmin(auth.admin), body);
  return NextResponse.json(payload, { status });
}

export const POST = POSTHandler;
