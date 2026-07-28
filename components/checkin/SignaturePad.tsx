'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { TextField } from '@/components/ui/TextField';
import type { SignatureInput } from '@/services/inductionSignature/signatureService';

/**
 * Digital signature capture for the induction Accept & Sign step (SC-011).
 *
 * Two modes — Draw (a canvas the worker signs with finger/stylus/mouse) and Type
 * (their name rendered in a signature face). A custom, dependency-free canvas
 * keeps the bundle lean. The captured value bubbles up as a SignatureInput (or
 * null while empty) via onChange; the parent submits it. The drawn image is
 * exported as a compact PNG data URL.
 */
export function SignaturePad({
  workerName,
  onChange,
}: {
  workerName: string;
  onChange: (value: SignatureInput | null) => void;
}) {
  const [mode, setMode] = useState<'DRAWN' | 'TYPED'>('DRAWN');
  const [typedName, setTypedName] = useState(workerName);
  const [hasInk, setHasInk] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Size the canvas to its container (crisp on retina), once mounted.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }
  }, []);

  const emit = useCallback(
    (nextMode: 'DRAWN' | 'TYPED', ink: boolean, name: string) => {
      if (nextMode === 'TYPED') {
        onChange(
          name.trim().length >= 2 ? { type: 'TYPED', name: name.trim() } : null,
        );
        return;
      }
      if (!ink) {
        onChange(null);
        return;
      }
      const canvas = canvasRef.current;
      const dataUrl = canvas ? canvas.toDataURL('image/png') : '';
      onChange(dataUrl ? { type: 'DRAWN', name: workerName, dataUrl } : null);
    },
    [onChange, workerName],
  );

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const p = pos(e);
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
    if (!hasInk) setHasInk(true);
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    emit('DRAWN', true, typedName);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    emit(mode, false, typedName);
  }

  function switchMode(next: 'DRAWN' | 'TYPED') {
    setMode(next);
    emit(next, hasInk, typedName);
  }

  return (
    <div>
      {/* Mode tabs */}
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-sunken p-1">
        <button
          type="button"
          onClick={() => switchMode('DRAWN')}
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-semibold',
            mode === 'DRAWN' ? 'bg-brand-600 text-white' : 'text-ink-muted',
          )}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => switchMode('TYPED')}
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-semibold',
            mode === 'TYPED' ? 'bg-brand-600 text-white' : 'text-ink-muted',
          )}
        >
          Type
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface"
        >
          Clear
        </button>
      </div>

      {mode === 'DRAWN' ? (
        <div className="relative">
          <canvas
            ref={canvasRef}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            className="h-48 w-full touch-none rounded-xl border-2 border-dashed border-line bg-surface"
          />
          {!hasInk && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-subtle">
              Sign here with your finger or stylus
            </span>
          )}
        </div>
      ) : (
        <div>
          <TextField
            label="Type your full name"
            value={typedName}
            onChange={(e) => {
              setTypedName(e.target.value);
              emit('TYPED', hasInk, e.target.value);
            }}
          />
          <div className="mt-3 flex h-24 items-center justify-center rounded-xl border-2 border-dashed border-line bg-surface">
            <span
              className="text-3xl text-ink"
              style={{
                fontFamily: '"Segoe Script", "Brush Script MT", cursive',
              }}
            >
              {typedName.trim() || 'Your signature'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
