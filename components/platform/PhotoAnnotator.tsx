'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PlatformIcon } from '@/components/platform/icons';
import {
  ANNOTATION_COLOURS,
  DEFAULT_COLOUR,
  DEFAULT_STROKE,
  DEFAULT_TEXT_SIZE,
  type Annotation,
  type AnnotationDocument,
  type AnnotationTool,
  type Point,
} from '@/services/annotations/annotationTypes';
import {
  drawAnnotations,
  drawPhoto,
  encodeCanvas,
  looksBlank,
} from '@/lib/annotationRender';
import { prepareForAnnotation } from '@/lib/imagePrep';

/**
 * SC-017 Photo annotation tool, built to the REV-1 mock-up: a focused overlay
 * with a left-hand vertical tool palette, a large central canvas, colour
 * selection, and Cancel / Save annotated photo in the header.
 *
 * Dependency-free canvas drawing, following SC-011's signature pad. Annotations
 * are kept as a VECTOR list (not baked pixels) so Undo/Redo are exact and the
 * work can be reopened and edited later; the flattened JPEG is produced only on
 * save.
 */

const TOOLS: {
  value: AnnotationTool;
  label: string;
  icon: Parameters<typeof PlatformIcon>[0]['name'];
}[] = [
  // Each icon now depicts the mark the tool leaves, or the instrument that
  // leaves it. These were navigation icons borrowed for want of better ones — a
  // grid for Select, a weight for Draw, a lightning bolt for Arrow, an info
  // circle for Circle, a document for Rectangle and a clipboard for Text — none
  // of which describe the action. Labels, order, behaviour and colours are
  // unchanged; only the glyphs.
  { value: 'select', label: 'Select', icon: 'cursor' },
  { value: 'draw', label: 'Draw', icon: 'pencil' },
  { value: 'arrow', label: 'Arrow', icon: 'arrow' },
  { value: 'circle', label: 'Circle', icon: 'circle' },
  { value: 'rectangle', label: 'Rectangle', icon: 'square' },
  { value: 'text', label: 'Text', icon: 'text' },
];

let seq = 0;
const nextId = () => `a${++seq}`;

export function PhotoAnnotator({
  file,
  initial,
  onCancel,
  onSave,
}: {
  file: File;
  /** Existing annotations, when reopening a previously annotated photo. */
  initial?: AnnotationDocument | null;
  onCancel: () => void;
  onSave: (result: {
    annotatedBlob: Blob;
    originalFile: File;
    document: AnnotationDocument;
  }) => void | Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const preparedRef = useRef<File | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const [tool, setTool] = useState<AnnotationTool>('select');
  const [colour, setColour] = useState(DEFAULT_COLOUR);
  const [annotations, setAnnotations] = useState<Annotation[]>(
    initial?.annotations ?? [],
  );
  const [redoStack, setRedoStack] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // --- load + prepare the photo (HEIC conversion, downscale) ---------------
  useEffect(() => {
    let cancelled = false;
    setError(null);
    prepareForAnnotation(file)
      .then(({ image, file: prepared, width, height }) => {
        if (cancelled) return;
        imageRef.current = image;
        preparedRef.current = prepared;
        sizeRef.current = { width, height };
        setReady(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Could not open that image.');
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // --- render ---------------------------------------------------------------
  /**
   * A photo that has not been painted yet is the reported "blank annotator":
   * `drawImage` does NOT throw on an image without a decoded frame, it simply
   * draws nothing, and nothing here would ever try again — the next redraw only
   * comes when an annotation changes, which is why the picture appeared the
   * moment someone started drawing.
   *
   * So the draw now reports whether it actually had something to paint, and the
   * caller retries on the next frame if it did not. `imagePrep` decodes before
   * resolving, which should make this unnecessary; this is the belt to that
   * pair of braces, because the failure is silent and the cost of it is a
   * manager marking up a photo they cannot see.
   */
  const render = useCallback((): boolean => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return false;
    const { width, height } = sizeRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const paintable = image.complete && image.naturalWidth > 0;
    ctx.clearRect(0, 0, width, height);
    // Same backdrop-then-photo the export uses, so the editor shows exactly what
    // will be stored. Without it a part-transparent PNG looked right here and
    // saved black, because the panel behind the canvas was doing the work that
    // the white backdrop does in the file.
    if (paintable) drawPhoto(ctx, image, width, height);
    drawAnnotations(
      ctx,
      draft ? [...annotations, draft] : annotations,
      width,
      height,
    );
    return paintable;
  }, [annotations, draft]);

  useEffect(() => {
    if (!ready) return;

    // Draw straight away so the photo is there as early as it can be...
    render();

    // ...and ALWAYS draw again on the next animation frame, even when that first
    // draw succeeded.
    //
    // WHY, and this is the reported bug: the first draw happens in an effect,
    // which runs BEFORE the browser has painted the newly mounted canvas. The
    // canvas bitmap is then correct — reading it back proves it — but on Firefox
    // with GPU-composited canvas the layer on screen can stay blank until
    // something invalidates it, which is why the photo appeared the moment a
    // tool was touched. Headless browsers composite in software and never show
    // it, which is why this took a second pass to find.
    //
    // A draw inside requestAnimationFrame happens after that first paint, so the
    // compositor has a laid-out, painted canvas to update. It costs one extra
    // drawImage on open and nothing else.
    let frames = 0;
    let raf = 0;
    const attempt = () => {
      const painted = render();
      frames += 1;
      // Two post-paint draws, not one: a single frame is easy to miss if layout
      // settles a frame late, and a second drawImage costs nothing next to a
      // blank annotator. Beyond that, keep going only while there is still no
      // image to paint, and give up after about a second rather than spinning.
      if (painted && frames >= 2) return;
      if (frames > 60) return;
      raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [ready, render]);

  // --- pointer handling -----------------------------------------------------
  const startRef = useRef<Point | null>(null);

  function toNormalised(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || tool === 'select') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toNormalised(e);
    startRef.current = p;

    if (tool === 'text') {
      const text = window.prompt('Label text');
      startRef.current = null;
      if (!text || !text.trim()) return;
      commit({
        id: nextId(),
        kind: 'text',
        colour,
        width: DEFAULT_STROKE,
        at: p,
        text: text.trim(),
        size: DEFAULT_TEXT_SIZE,
      });
      return;
    }

    if (tool === 'draw') {
      setDraft({
        id: nextId(),
        kind: 'draw',
        colour,
        width: DEFAULT_STROKE,
        points: [p],
      });
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!startRef.current || tool === 'select' || tool === 'text') return;
    const p = toNormalised(e);
    const base = { id: 'draft', colour, width: DEFAULT_STROKE };
    if (tool === 'draw') {
      setDraft((d) =>
        d && d.kind === 'draw' ? { ...d, points: [...d.points, p] } : d,
      );
    } else if (tool === 'arrow') {
      setDraft({ ...base, kind: 'arrow', from: startRef.current, to: p });
    } else if (tool === 'circle') {
      setDraft({ ...base, kind: 'circle', from: startRef.current, to: p });
    } else if (tool === 'rectangle') {
      setDraft({ ...base, kind: 'rectangle', from: startRef.current, to: p });
    }
  }

  function onPointerUp() {
    if (draft) commit({ ...draft, id: nextId() });
    setDraft(null);
    startRef.current = null;
  }

  function commit(a: Annotation) {
    setAnnotations((list) => [...list, a]);
    // A new annotation invalidates the redo branch — standard editor behaviour.
    setRedoStack([]);
  }

  function undo() {
    setAnnotations((list) => {
      if (list.length === 0) return list;
      const last = list[list.length - 1]!;
      setRedoStack((r) => [...r, last]);
      return list.slice(0, -1);
    });
  }

  function redo() {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const last = r[r.length - 1]!;
      setAnnotations((list) => [...list, last]);
      return r.slice(0, -1);
    });
  }

  function clearAll() {
    if (annotations.length === 0) return;
    setRedoStack([]);
    setAnnotations([]);
  }

  async function save() {
    const image = imageRef.current;
    const original = preparedRef.current;
    if (!image || !original) return;
    // An image with no decoded frame would produce markings on an empty
    // backdrop. Refuse early: a manager can retry, and cannot be handed a
    // silently empty record.
    if (!image.complete || image.naturalWidth === 0) {
      setError('The photo is still loading. Please try again in a moment.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Export the canvas ON SCREEN — the one showing the photo and the markings
      // — rather than re-drawing into a detached canvas that nobody has seen.
      // Redraw first so it is definitely current (no in-progress draft is left,
      // since saving happens after the pointer is released).
      const canvas = canvasRef.current;
      if (!canvas || !render()) {
        setError('The photo is still loading. Please try again in a moment.');
        return;
      }
      const blob = await encodeCanvas(canvas);

      // NEVER STORE AN IMAGE WE CANNOT PROVE HAS CONTENT. A blank canvas encodes
      // to a valid, plausible-sized, completely black JPEG, and nothing further
      // down the line can tell that from a dark photograph — not the upload, not
      // the thumbnail, not the close-out pack. An annotated photo that is black
      // is worse than no photo: it looks like evidence and is not.
      if (await looksBlank(blob)) {
        setError(
          'The annotated image came out blank, so it has not been saved. Your photo and markings are still here — please try Save again, and if it keeps happening tell your administrator which browser you are using.',
        );
        return;
      }

      await onSave({
        annotatedBlob: blob,
        originalFile: original,
        document: { version: 1, annotations },
      });
    } catch (e) {
      setError((e as Error).message || 'Could not save the annotated photo.');
    } finally {
      setSaving(false);
    }
  }

  // Escape cancels, matching every other dialog in the product.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Annotate photo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-2 sm:p-4"
    >
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-surface shadow-card">
        {/* Header — title + Cancel / Save annotated photo, as in the mock-up. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink">Annotate photo</h2>
            <p className="text-xs text-ink-subtle">
              Use the tools to highlight issues or areas of concern.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="touch-target rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!ready || saving}
              className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save annotated photo'}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 sm:flex-row">
          {/* Left-hand vertical tool palette. */}
          <div className="flex shrink-0 flex-row flex-wrap gap-1.5 sm:w-28 sm:flex-col">
            {TOOLS.map((t) => {
              const active = tool === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTool(t.value)}
                  aria-pressed={active}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
                    active
                      ? 'border-brand-500 bg-brand-600 text-white'
                      : 'border-line bg-surface text-ink-muted hover:bg-surface-sunken'
                  }`}
                >
                  <PlatformIcon name={t.icon} className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}

            {/* Colour selection. */}
            <div className="rounded-lg border border-line p-2">
              <p className="mb-1 text-[11px] font-semibold text-ink-muted">
                Colour
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ANNOTATION_COLOURS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColour(c.value)}
                    aria-label={c.label}
                    aria-pressed={colour === c.value}
                    style={{ backgroundColor: c.value }}
                    className={`h-6 w-6 rounded-full border transition ${
                      colour === c.value
                        ? 'ring-2 ring-brand-600 ring-offset-1'
                        : 'border-line'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="mt-1 flex flex-row gap-1.5 sm:flex-col">
              <button
                type="button"
                onClick={undo}
                disabled={annotations.length === 0}
                className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-40"
              >
                ↶ Undo
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={redoStack.length === 0}
                className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-40"
              >
                ↷ Redo
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={annotations.length === 0}
                className="flex items-center gap-2 rounded-lg border border-danger-500/40 px-2.5 py-2 text-xs font-semibold text-danger-600 hover:bg-danger-50 disabled:opacity-40"
              >
                Clear all
              </button>
            </div>
          </div>

          {/* Large central canvas. */}
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-lg bg-surface-sunken p-2">
            {error ? (
              <p className="p-6 text-center text-sm font-medium text-danger-600">
                {error}
              </p>
            ) : !ready ? (
              <p className="p-6 text-sm text-ink-subtle">Preparing photo…</p>
            ) : (
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                // touch-none stops the page scrolling under a drawing finger.
                className={`max-h-[60vh] w-auto max-w-full touch-none rounded ${
                  tool === 'select' ? 'cursor-default' : 'cursor-crosshair'
                }`}
              />
            )}
          </div>
        </div>

        <p className="border-t border-line px-4 py-2 text-[11px] text-ink-subtle">
          The original photo is kept unchanged — the annotated copy is saved
          alongside it.
        </p>
      </div>
    </div>
  );
}
