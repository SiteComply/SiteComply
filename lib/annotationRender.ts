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
 * Flatten a photo plus its annotations into a JPEG blob — what actually gets
 * uploaded and shown in reports and print views.
 */
export function flatten(
  image: CanvasImageSource,
  annotations: Annotation[],
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is not available.'));
  ctx.drawImage(image, 0, 0, width, height);
  drawAnnotations(ctx, annotations, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Could not save the image.')),
      'image/jpeg',
      0.92,
    );
  });
}
