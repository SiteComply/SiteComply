import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { saveSetupStep } from '@/services/sites/siteSetupService';

export const dynamic = 'force-dynamic';

/**
 * SC-019 Phase 1 — save one step of the project setup wizard.
 *
 * One endpoint for every step rather than a route each: authorisation, site
 * scoping and the save-and-resume progress record are then handled in exactly one
 * place. The service decides which role may edit which step (project-level steps
 * are Director-only; operational steps follow sites:edit, preserving the split
 * SC-008 established).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }

  let body: {
    stepKey?: string;
    values?: Record<string, unknown>;
    markComplete?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (!body.stepKey) {
    return NextResponse.json(
      { ok: false, error: 'Which step is this?' },
      { status: 400 },
    );
  }

  const result = await saveSetupStep(viewer, params.id, {
    stepKey: body.stepKey,
    values: body.values ?? {},
    markComplete: body.markComplete === true,
  });

  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    return NextResponse.json(
      {
        ok: false,
        error:
          result.error ??
          (result.reason === 'forbidden'
            ? 'You do not have permission to edit this part of the site setup.'
            : 'Site not found.'),
      },
      { status },
    );
  }

  return NextResponse.json({ ok: true });
}
