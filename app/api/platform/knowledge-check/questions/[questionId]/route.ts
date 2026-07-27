import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { setQuestionActiveForViewer } from '@/services/knowledgeChecks/bankAdminService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/knowledge-check/questions/[questionId]
 * Body: { active: boolean }
 * Withdraw (or restore) a knowledge-check question after a flag review. Scoped to
 * the viewer's sites; resolves any open flags on the question.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { questionId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'sites', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden.' },
      { status: 403 },
    );
  }

  let body: { active?: boolean };
  try {
    body = (await req.json()) as { active?: boolean };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }
  if (typeof body.active !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const result = await setQuestionActiveForViewer(
    viewer,
    params.questionId,
    body.active,
  );
  if (!result.ok) {
    const status = result.reason === 'forbidden' ? 403 : 404;
    return NextResponse.json(
      { ok: false, error: 'Could not update.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}
