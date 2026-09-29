import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { videoActorFromAdmin } from '@/services/inductionVideo/videoActor';
import { siteProgress } from '@/services/inductionVideo/progressService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — the Admin Centre's half of the project-level poll. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const admin = getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const progress = await siteProgress(videoActorFromAdmin(admin), params.id);
  if (!progress) {
    return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...progress });
}
