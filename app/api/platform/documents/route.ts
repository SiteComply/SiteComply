import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateDocumentMeta,
  validateUploadFile,
  createDocument,
  type DocumentMetaInput,
} from '@/services/documents/documentService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/documents
 * Multipart upload of a site document. Enforces the documents "create"
 * permission and the Assigned-Sites boundary (the chosen site must be in scope).
 * The file is streamed to private blob storage; the DB row records its metadata.
 */
export async function POST(req: NextRequest) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'documents', 'create')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to upload documents.' },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid upload.' }, { status: 400 });
  }

  const fileEntry = form.get('file');
  const file = fileEntry instanceof File ? fileEntry : null;
  const fileCheck = validateUploadFile(
    file ? { size: file.size, type: file.type } : null,
  );
  if (!fileCheck.ok) {
    return NextResponse.json(
      { ok: false, errors: { file: fileCheck.error } },
      { status: 400 },
    );
  }

  const meta: DocumentMetaInput = {
    title: (form.get('title') as string) ?? undefined,
    description: (form.get('description') as string) ?? undefined,
    category: (form.get('category') as string) ?? undefined,
    jobSiteId: (form.get('jobSiteId') as string) ?? undefined,
    expiresAt: (form.get('expiresAt') as string) ?? undefined,
  };
  const result = validateDocumentMeta(meta, viewer);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  const buffer = Buffer.from(await file!.arrayBuffer());
  const created = await createDocument(viewer, result.value, {
    buffer,
    fileName: file!.name || 'document',
    mimeType: file!.type,
    size: file!.size,
  });

  return NextResponse.json({ ok: true, id: created.id });
}
