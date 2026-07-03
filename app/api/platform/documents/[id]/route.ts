import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  validateDocumentMeta,
  updateDocument,
  deleteDocument,
  type DocumentMetaInput,
} from '@/services/documents/documentService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/platform/documents/[id]
 * Update a document's details / site assignment. Enforces the documents "edit"
 * permission and the Assigned-Sites boundary (both the existing and target site
 * must be in scope). Body: { title, description, category, jobSiteId }.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'documents', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to edit documents.' },
      { status: 403 },
    );
  }

  let body: DocumentMetaInput;
  try {
    body = (await req.json()) as DocumentMetaInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const result = validateDocumentMeta(body, viewer);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  const updated = await updateDocument(viewer, params.id, result.value);
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: 'Document not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: updated.id });
}

/**
 * DELETE /api/platform/documents/[id]
 * Permanently delete a document — its metadata row AND its blob file. Enforces
 * the documents "edit" permission (deletion is a management action) and the
 * Assigned-Sites boundary (the document must be in the viewer's scope).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (!permits(viewer.role, 'documents', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to delete documents.' },
      { status: 403 },
    );
  }

  const deleted = await deleteDocument(viewer, params.id);
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: 'Document not found.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
