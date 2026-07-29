/**
 * SC-017 — the editable annotation model, stored as `annotationData` alongside
 * the flattened annotated image so annotations can be REOPENED and edited.
 *
 * Client-safe: no server imports. Coordinates are stored NORMALISED (0–1 of the
 * image width/height) rather than in pixels, so a stored annotation still lands
 * in the right place if the same photo is later rendered at a different size —
 * on a phone, in a print view, or after the long-edge cap changes.
 */

export type AnnotationTool =
  | 'select'
  | 'draw'
  | 'arrow'
  | 'circle'
  | 'rectangle'
  | 'text';

export interface Point {
  x: number;
  y: number;
}

interface Base {
  id: string;
  colour: string;
  /** Stroke width as a fraction of the image's long edge, so it scales too. */
  width: number;
}

export interface FreehandAnnotation extends Base {
  kind: 'draw';
  points: Point[];
}
export interface ArrowAnnotation extends Base {
  kind: 'arrow';
  from: Point;
  to: Point;
}
export interface CircleAnnotation extends Base {
  kind: 'circle';
  /** Bounding box, so a circle is really an ellipse — as in the mock-up. */
  from: Point;
  to: Point;
}
export interface RectangleAnnotation extends Base {
  kind: 'rectangle';
  from: Point;
  to: Point;
}
export interface TextAnnotation extends Base {
  kind: 'text';
  at: Point;
  text: string;
  /** Font size as a fraction of the image's long edge. */
  size: number;
}

export type Annotation =
  | FreehandAnnotation
  | ArrowAnnotation
  | CircleAnnotation
  | RectangleAnnotation
  | TextAnnotation;

/** What gets persisted in `annotationData`. Versioned so it can evolve safely. */
export interface AnnotationDocument {
  version: 1;
  annotations: Annotation[];
}

/**
 * The annotation palette. Deliberately distinct from the SC-014 chart palette and
 * from the reserved status colours — these are marker colours chosen to stay
 * visible against site photography (concrete, steel, hi-vis), and red/blue/green
 * match the three annotations shown in the REV-1 mock-up.
 */
export const ANNOTATION_COLOURS: { value: string; label: string }[] = [
  { value: '#E11D48', label: 'Red' },
  { value: '#2563EB', label: 'Blue' },
  { value: '#16A34A', label: 'Green' },
  { value: '#F59E0B', label: 'Amber' },
  { value: '#111827', label: 'Black' },
  { value: '#FFFFFF', label: 'White' },
];

export const DEFAULT_COLOUR = ANNOTATION_COLOURS[0]!.value;
/** Stroke width and text size as fractions of the image's long edge. */
export const DEFAULT_STROKE = 0.006;
export const DEFAULT_TEXT_SIZE = 0.045;

export function isAnnotationDocument(v: unknown): v is AnnotationDocument {
  if (!v || typeof v !== 'object') return false;
  const d = v as AnnotationDocument;
  return d.version === 1 && Array.isArray(d.annotations);
}
