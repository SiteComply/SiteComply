import type { Annotation, Point } from '@/services/annotations/annotationTypes';

/**
 * SC-017 — draw the annotation list onto a canvas context.
 *
 * Shared by the live editor and the flatten-on-save step, so what you draw is
 * exactly what gets saved. Coordinates arrive NORMALISED (0–1) and are scaled to
 * the target size here — the single place that conversion happens.
 */

export function denormalise(p: Point, w: number, h: number): Point {
  return { x: p.x * w, y: p.y * h };
}

/**
 * The backdrop every annotated photo is composed on.
 *
 * A PNG can carry an alpha channel and JPEG cannot. Drawing a part-transparent
 * PNG onto a fresh canvas leaves those pixels transparent, and JPEG encodes
 * transparent as BLACK — so a screenshot or exported diagram saved through the
 * annotator came out as a black image, or a black background with the content
 * floating on it.
 *
 * Worse, it looked fine while you worked: the editor canvas is transparent too,
 * so the light panel behind it showed through and the photo appeared normal
 * right up until it was saved.
 *
 * So both the editor and the export now paint an opaque white backdrop first.
 * White rather than the panel's grey because these end up printed into close-out
 * packs and audit reports, on paper that is white.
 */
export const PHOTO_BACKDROP = '#ffffff';

/**
 * Paint the opaque backdrop, then the photo. Used by BOTH the live editor and
 * flatten-on-save, so what you see is what is stored — the two drifting apart is
 * how a transparent PNG looked correct on screen and black in the record.
 */
export function drawPhoto(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.fillStyle = PHOTO_BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  ctx.drawImage(image, 0, 0, width, height);
}

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  width: number,
  height: number,
): void {
  const longEdge = Math.max(width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const a of annotations) {
    ctx.strokeStyle = a.colour;
    ctx.fillStyle = a.colour;
    ctx.lineWidth = Math.max(1, a.width * longEdge);

    switch (a.kind) {
      case 'draw': {
        if (a.points.length < 2) break;
        ctx.beginPath();
        const first = denormalise(a.points[0]!, width, height);
        ctx.moveTo(first.x, first.y);
        for (const p of a.points.slice(1)) {
          const q = denormalise(p, width, height);
          ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        break;
      }
      case 'rectangle': {
        const f = denormalise(a.from, width, height);
        const t = denormalise(a.to, width, height);
        ctx.strokeRect(f.x, f.y, t.x - f.x, t.y - f.y);
        break;
      }
      case 'circle': {
        // An ellipse inscribed in the drag box — matches the mock-up, where the
        // "circle" round the cable tray is clearly elliptical.
        const f = denormalise(a.from, width, height);
        const t = denormalise(a.to, width, height);
        const cx = (f.x + t.x) / 2;
        const cy = (f.y + t.y) / 2;
        const rx = Math.abs(t.x - f.x) / 2;
        const ry = Math.abs(t.y - f.y) / 2;
        if (rx < 1 || ry < 1) break;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arrow': {
        const f = denormalise(a.from, width, height);
        const t = denormalise(a.to, width, height);
        const dx = t.x - f.x;
        const dy = t.y - f.y;
        const len = Math.hypot(dx, dy);
        if (len < 2) break;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        // Solid head, sized off the stroke so it stays proportionate.
        const head = Math.max(ctx.lineWidth * 3.5, longEdge * 0.018);
        const angle = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(
          t.x - head * Math.cos(angle - Math.PI / 7),
          t.y - head * Math.sin(angle - Math.PI / 7),
        );
        ctx.lineTo(
          t.x - head * Math.cos(angle + Math.PI / 7),
          t.y - head * Math.sin(angle + Math.PI / 7),
        );
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'text': {
        const at = denormalise(a.at, width, height);
        const size = Math.max(10, a.size * longEdge);
        ctx.font = `600 ${size}px system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        // A dark halo keeps light text readable against a bright photo and vice
        // versa — site photos have no predictable background.
        ctx.lineWidth = Math.max(2, size * 0.12);
        ctx.strokeStyle =
          a.colour.toUpperCase() === '#FFFFFF' ? '#111827' : '#FFFFFF';
        ctx.strokeText(a.text, at.x, at.y);
        ctx.fillStyle = a.colour;
        ctx.fillText(a.text, at.x, at.y);
        break;
      }
    }
  }
}

/**
 * Encode a canvas that is ALREADY DRAWN into a JPEG blob.
 *
 * The saved photo is now exported from the canvas the user has been looking at,
 * rather than re-rendered into a second, detached one. That detached canvas was
 * where the black images came from: it is never inserted in the document and
 * never composited, and re-doing the drawing into it is a second chance for the
 * draw to come out empty — after which `toBlob` encodes an untouched canvas, and
 * JPEG turns "untouched" into solid black.
 *
 * Exporting the visible canvas removes the whole class of failure: the pixels
 * being encoded are the pixels on screen, so if the editor shows the photo, the
 * file has the photo. What you see is literally what is stored.
 */
export function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Could not save the image.')),
      'image/jpeg',
      0.92,
    );
  });
}

/**
 * Decode a JPEG blob and report whether it actually contains an image.
 *
 * THE LAST LINE OF DEFENCE, and the one that does not depend on knowing why a
 * save failed. A blank canvas encodes to a perfectly valid, perfectly black
 * JPEG — no error, no exception, a sensible file size. Nothing downstream can
 * tell that apart from a photograph of something dark, so the check has to
 * happen here, before the bytes are ever uploaded.
 *
 * "Blank" is near-uniform AND essentially black or essentially white — the two
 * things an EMPTY canvas encodes to: black when nothing was drawn at all
 * (transparent, and JPEG has no alpha), white when the backdrop was painted and
 * the photo was not.
 *
 * Uniformity alone is NOT enough, and testing caught that: a photo that is one
 * flat colour — a painted wall, a solid-colour screenshot — is perfectly uniform
 * and perfectly legitimate, and an earlier version of this check refused to save
 * it. Refusing real evidence to avoid storing a blank is the wrong trade.
 *
 * Sampled on a small thumbnail so the cost is a few milliseconds regardless of
 * photo size.
 */
export async function looksBlank(blob: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(blob);
    const w = Math.min(64, bitmap.width);
    const h = Math.min(64, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const { data } = ctx.getImageData(0, 0, w, h);
    let min = 255;
    let max = 0;
    let total = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Luminance is enough: a real photo varies, a blank export does not.
      const l =
        (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
      if (l < min) min = l;
      if (l > max) max = l;
      total += l;
      count += 1;
    }
    const uniform = max - min < 4;
    const mean = count ? total / count : 0;
    return uniform && (mean < 12 || mean > 243);
  } catch {
    // If it cannot even be decoded, treat it as unusable rather than storing it.
    return true;
  }
}
