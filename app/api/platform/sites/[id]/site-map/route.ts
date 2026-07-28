import { NextRequest, NextResponse } from 'next/server';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  setSiteMap,
  removeSiteMap,
} from '@/services/sites/siteInformationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(viewer: Awaited<ReturnType<typeof getPlatformViewer>>) {
  if (!viewer) return { status: 401, error: 'Not signed in.' };
  if (!permits(viewer.role, 'sites', 'edit'))
    return { status: 403, error: 'You cannot configure this site.' };
  return null;
}

/**
 * POST /api/platform/sites/[id]/site-map — multipart upload of the site-map
 * image (SC-008). Reuses the Documents module's private Azure Blob storage;
 * bytes are streamed back to workers only through the authenticated worker
 * route. Gated on `sites` edit + scope.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  const blocked = guard(viewer);
  if (blocked) {
    return NextResponse.json(
      { ok: false, error: blocked.error },
      { status: blocked.status },
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
  if (!file) {
    return NextResponse.json(
      { ok: false, error: 'Choose an image to upload.' },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await setSiteMap(viewer!, params.id, {
    buffer,
    fileName: file.name || 'site-map',
    mimeType: file.type,
    size: file.size,
  });
  if (!result.ok) {
    const status =
      result.reason === 'forbidden'
        ? 403
        : result.reason === 'not_found'
          ? 404
          : 400;
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Could not upload the site map.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/platform/sites/[id]/site-map — remove the site-map image. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await getPlatformViewer();
  const blocked = guard(viewer);
  if (blocked) {
    return NextResponse.json(
      { ok: false, error: blocked.error },
      { status: blocked.status },
    );
  }

  const result = await removeSiteMap(viewer!, params.id);
  if (!result.ok) {
    const status = result.reason === 'forbidden' ? 403 : 404;
    return NextResponse.json(
      { ok: false, error: 'Could not remove the site map.' },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}
