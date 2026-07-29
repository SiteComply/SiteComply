/**
 * SC-017 — client-side image preparation for the photo annotator.
 *
 * Two jobs, both browser-side and both necessary before a photo can be annotated:
 *
 * 1. HEIC conversion. iPhones shoot HEIC by default and uploads already accept
 *    it, but a <canvas> CANNOT decode HEIC in Chrome or Firefox (Safari can). So
 *    exactly the photos site staff most often take would fail to annotate. HEIC
 *    is converted to JPEG up front; the decoder is imported DYNAMICALLY so its
 *    weight is only paid by users who actually pick a HEIC file.
 *
 * 2. Downscale. Phone photos are routinely 12MP+ and the upload limit allows 20
 *    MB. Annotating at full resolution janks low-end site tablets, so the working
 *    image is capped on its long edge — big enough to see a defect, small enough
 *    to draw on with a gloved finger.
 */

/** Long-edge cap for the annotation canvas and the saved annotated copy. */
export const MAX_ANNOTATION_EDGE = 2000;

/** Image types the annotator can open. HEIC is converted to JPEG first. */
export const ANNOTATABLE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const HEIC_MIME_TYPES = ['image/heic', 'image/heif'] as const;

export function isHeic(file: File): boolean {
  if ((HEIC_MIME_TYPES as readonly string[]).includes(file.type)) return true;
  // Some browsers report an empty type for .heic — fall back to the extension.
  return /\.hei[cf]$/i.test(file.name);
}

export function isAnnotatable(file: File): boolean {
  return (
    (ANNOTATABLE_MIME_TYPES as readonly string[]).includes(file.type) ||
    isHeic(file)
  );
}

/**
 * Convert a HEIC file to JPEG. Returns the original file unchanged when it isn't
 * HEIC, so callers can apply this unconditionally.
 */
export async function convertHeicIfNeeded(file: File): Promise<File> {
  if (!isHeic(file)) return file;

  // Dynamic import: never loaded unless a HEIC file is actually chosen.
  const heic2any = (await import('heic2any')).default;
  const converted = (await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92,
  })) as Blob | Blob[];
  const blob = Array.isArray(converted) ? converted[0]! : converted;
  const name = file.name.replace(/\.hei[cf]$/i, '') || 'photo';
  return new File([blob], `${name}.jpg`, {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}

/** Load a File into an HTMLImageElement, cleaning up its object URL. */
export function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

/** Scale factor to fit an image inside the long-edge cap (never upscales). */
export function fitScale(
  width: number,
  height: number,
  maxEdge = MAX_ANNOTATION_EDGE,
): number {
  const longest = Math.max(width, height);
  return longest <= maxEdge ? 1 : maxEdge / longest;
}

/**
 * Prepare a chosen file for annotation: convert HEIC, then decode and downscale.
 * Returns the drawable image plus the (possibly converted) file, so the ORIGINAL
 * upload stored alongside the annotation is the converted JPEG rather than a
 * HEIC no browser could later display.
 */
export async function prepareForAnnotation(file: File): Promise<{
  image: HTMLImageElement;
  file: File;
  width: number;
  height: number;
}> {
  const prepared = await convertHeicIfNeeded(file);
  const image = await loadImage(prepared);
  const scale = fitScale(image.naturalWidth, image.naturalHeight);
  return {
    image,
    file: prepared,
    width: Math.round(image.naturalWidth * scale),
    height: Math.round(image.naturalHeight * scale),
  };
}
