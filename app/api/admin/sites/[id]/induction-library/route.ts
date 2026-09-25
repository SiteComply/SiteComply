import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { moduleActorFromAdmin } from '@/services/inductionModules/moduleActor';
import {
  setSiteLibraryDecision,
  type SiteLibraryInput,
} from '@/services/inductionVideo/libraryAssetService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The same decision, from the Admin Centre. An admin acts on every project. */
async function POSTHandler(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const input: SiteLibraryInput =
    body.state === 'EXCLUDED'
      ? { state: 'EXCLUDED', reason: str('reason') }
      : body.state === 'INCLUDED'
        ? { state: 'INCLUDED' }
        : { state: 'DEFAULT' };

  const r = await setSiteLibraryDecision(
    moduleActorFromAdmin(auth.admin),
    params.id,
    str('assetId'),
    input,
  );
  return r.ok
    ? NextResponse.json({ ok: true, ...r.value })
    : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
}

export const POST = POSTHandler;
