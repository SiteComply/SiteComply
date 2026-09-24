import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { moduleActorFromAdmin } from '@/services/inductionModules/moduleActor';
import { handleModuleAction } from '@/services/inductionModules/moduleActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Company induction modules, from the Admin Centre (an Entra SSO admin).
 *
 * ── A SECOND FRONT DOOR, NOT A SECOND SYSTEM ──────────────────────────────
 *
 * Identical actions on identical data, through the same dispatcher and the same
 * service. The only thing this route does that the Platform one does not is
 * resolve authority from an AdminRole instead of a PlatformRole.
 *
 * ── WHY A SEPARATE ROUTE AND NOT ONE SHARED ENDPOINT ──────────────────────
 *
 * Someone can hold both a Platform session and an Admin session in one browser.
 * A single endpoint accepting "whichever session exists" would have to choose,
 * and could attribute an issued revision to the wrong identity in a record meant
 * to be read years later. Two routes make attribution unambiguous.
 *
 * OWNER and ADMIN both manage, by the owner's decision. VIEWER is refused here by
 * `ADMIN_WRITE_ROLES` and refused again in the service, which sees a capability
 * of false — the gate is not the route's alone.
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

  const { status, payload } = await handleModuleAction(
    moduleActorFromAdmin(auth.admin),
    body,
  );
  return NextResponse.json(payload, { status });
}

export const POST = POSTHandler;
