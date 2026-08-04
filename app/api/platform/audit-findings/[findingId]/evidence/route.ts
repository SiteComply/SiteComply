import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { parseAnnotationMeta } from '@/services/annotations/annotationUpload';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateEvidenceFile,
  addFindingEvidence,
} from '@/services/audits/findingEvidenceService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/audit-findings/[findingId]/evidence
 * Multipart upload of a photo/document as evidence against a finding. Enforces
 * the audits "edit" permission and the Assigned-Sites boundary (the finding's
 * audit must be in the viewer's scope). Streamed to the private blob container.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { findingId: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (!permits(viewer.role, 'audits', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to upload evidence.' },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid upload.' },
      { status: 400 },
    );
  }

  const entry = form.get('file');
  const file = entry instanceof File ? entry : null;
  const check = validateEvidenceFile(
    file ? { size: file.size, type: file.type } : null,
  );
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: check.error },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file!.arrayBuffer());
  // SC-017 FOLLOW-UP — THIS WAS NEVER WIRED UP. `parseAnnotationMeta` has been
  // imported here since SC-017 but was never called, and the service's optional
  // annotation argument was never passed, so every annotated photo on a finding
  // was stored as a plain file with `annotated = false` and no link back to its
  // original. That is the whole reported duplication: not two files by design,
  // but two files the product could not tell were the same photo.
  const annotation = parseAnnotationMeta(form);
  const result = await addFindingEvidence(
    viewer,
    params.findingId,
    {
      buffer,
      fileName: file!.name || 'evidence',
      mimeType: file!.type,
      size: file!.size,
    },
    annotation,
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: 'Finding not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}
