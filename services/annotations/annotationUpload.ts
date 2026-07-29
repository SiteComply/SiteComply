import type { AnnotationDocument } from '@/services/annotations/annotationTypes';
import { isAnnotationDocument } from '@/services/annotations/annotationTypes';

/**
 * SC-017 — the annotation metadata that may accompany an evidence upload. The
 * annotated copy is a SEPARATE row pointing back at the original, so the
 * untouched photo always remains part of the record.
 */
export interface AnnotationMeta {
  annotated: boolean;
  originalEvidenceId: string | null;
  annotationData: AnnotationDocument | null;
}

/** Parse + validate annotation fields off an upload form. Never throws. */
export function parseAnnotationMeta(form: {
  get(name: string): unknown;
}): AnnotationMeta {
  const annotated = String(form.get('annotated') ?? '') === 'true';
  if (!annotated) {
    return { annotated: false, originalEvidenceId: null, annotationData: null };
  }
  const originalRaw = form.get('originalEvidenceId');
  const originalEvidenceId =
    typeof originalRaw === 'string' && originalRaw ? originalRaw : null;

  let annotationData: AnnotationDocument | null = null;
  const dataRaw = form.get('annotationData');
  if (typeof dataRaw === 'string' && dataRaw) {
    try {
      const parsed: unknown = JSON.parse(dataRaw);
      if (isAnnotationDocument(parsed)) annotationData = parsed;
    } catch {
      // Malformed annotation data must never block the upload — the flattened
      // image is what matters; only re-editing is lost.
      annotationData = null;
    }
  }
  return { annotated: true, originalEvidenceId, annotationData };
}
