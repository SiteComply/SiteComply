import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateEvidenceFile,
  addActionEvidence,
} from '@/services/actions/actionEvidenceService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/actions/[id]/evidence
 * Multipart upload of a photo/document as evidence against an action. Enforces
 * the actions "edit" permission and the Assigned-Sites boundary (the action must
 * be in the viewer's scope). The file is streamed to the private blob container;
 * the DB row records its metadata + uploader.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'actions', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to upload evidence.' },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid upload.' }, { status: 400 });
  }

  const entry = form.get('file');
  const file = entry instanceof File ? entry : null;
  const check = validateEvidenceFile(file ? { size: file.size, type: file.type } : null);
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: 400 });
  }

  const buffer = Buffer.from(await file!.arrayBuffer());
  const result = await addActionEvidence(viewer, params.id, {
    buffer,
    fileName: file!.name || 'evidence',
    mimeType: file!.type,
    size: file!.size,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'Action not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: result.id });
}
