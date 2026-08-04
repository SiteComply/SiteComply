import type { AnnotationDocument } from '@/services/annotations/annotationTypes';

/**
 * SC-017 — uploading an annotated photo, in one place.
 *
 * THE ORDER IS THE INTEGRITY STORY. The untouched original is uploaded first so
 * the annotated copy can point back at it; get that the wrong way round and the
 * annotated copy has nothing to link to, which is how an audit record loses the
 * evidence of what the camera actually saw. It was written out once in the
 * evidence gallery; the finding form now needs exactly the same sequence, so it
 * lives here rather than being typed a second time.
 *
 * The original is still ALWAYS stored. What changed in the follow-up is only
 * that it is no longer presented or reported — see `supersededEvidence.ts`.
 */
export interface AnnotatedPhotoResult {
  annotatedBlob: Blob;
  originalFile: File;
  document: AnnotationDocument;
}

export type UploadOutcome =
  | { ok: true; annotatedId: string; originalId: string }
  | { ok: false; error: string };

/**
 * POST the original, then the annotated copy linked to it.
 *
 * `basePath` is the evidence collection endpoint — the same one the gallery
 * uses, so permissions, validation and the audit fields (uploaded by, when) are
 * whatever that route already enforces. Nothing here is privileged.
 */
export async function uploadAnnotatedPair(
  basePath: string,
  result: AnnotatedPhotoResult,
): Promise<UploadOutcome> {
  const post = async (
    file: File,
    extra?: Record<string, string>,
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
      const res = await fetch(basePath, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error ?? 'Upload failed.' };
      }
      return { ok: true, id: data.id as string };
    } catch {
      return { ok: false, error: 'Network problem.' };
    }
  };

  const original = await post(result.originalFile);
  if (!original.ok) return { ok: false, error: original.error };

  const base = result.originalFile.name.replace(/\.[^.]+$/, '') || 'photo';
  const annotatedFile = new File(
    [result.annotatedBlob],
    `${base}-annotated.jpg`,
    { type: 'image/jpeg' },
  );
  const annotated = await post(annotatedFile, {
    annotated: 'true',
    originalEvidenceId: original.id,
    annotationData: JSON.stringify(result.document),
  });
  // The original landed and the annotated copy did not. Say so precisely: the
  // photo IS attached, it simply has no markings, and "upload failed" would send
  // someone hunting for a file that is already there.
  if (!annotated.ok) {
    return {
      ok: false,
      error: `${annotated.error} The unmarked photo was attached.`,
    };
  }

  return { ok: true, annotatedId: annotated.id, originalId: original.id };
}
