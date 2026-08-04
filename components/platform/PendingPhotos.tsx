'use client';

import { useEffect, useRef, useState } from 'react';
import { PhotoAnnotator } from '@/components/platform/PhotoAnnotator';
import { isAnnotatable } from '@/lib/imagePrep';
import type { AnnotatedPhotoResult } from '@/components/platform/annotatedUpload';

export interface PendingPhoto extends AnnotatedPhotoResult {
  /** Local key — these photos have no server id until the finding is saved. */
  key: string;
  previewUrl: string;
}

/**
 * SC-017 FOLLOW-UP — photos added and annotated WHILE a finding is being written.
 *
 * Before this, evidence could only be attached to a finding that already
 * existed: you wrote the finding, saved it, found it in the list, expanded it,
 * uploaded a photo, then annotated it. On site, holding a phone, that is four
 * screens between seeing a problem and recording it.
 *
 * The photos are held here in the browser until the finding is saved. Nothing is
 * uploaded early: an abandoned form must not leave orphaned evidence attached to
 * a finding that was never created, and there is no finding id to attach it to
 * anyway. On save the form creates the finding and then posts each photo to the
 * SAME evidence endpoint the gallery uses — same permission check, same
 * validation, same uploaded-by and timestamp.
 *
 * Choosing a photo opens the annotator immediately, which is what makes this one
 * movement: add photo, mark it up, keep going. Cancelling the annotator discards
 * that photo and nothing else, exactly as it does in the gallery.
 */
export function PendingPhotos({
  photos,
  onChange,
  disabled = false,
}: {
  photos: PendingPhoto[];
  onChange: (next: PendingPhoto[]) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [annotating, setAnnotating] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();

  // Object URLs are a real allocation; release them when the form goes away or
  // a photo is removed, or a long editing session leaks every photo it touched.
  useEffect(() => {
    return () => {
      for (const p of photos) URL.revokeObjectURL(p.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(file: File) {
    setError(undefined);
    if (!isAnnotatable(file)) {
      // Findings take photographs. Anything else still belongs on the finding,
      // but it can only be attached once the finding exists, so say that plainly
      // rather than silently ignoring the file.
      setError(
        'Only photos can be added here. Save the finding first to attach documents.',
      );
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setAnnotating(file);
  }

  function keep(result: AnnotatedPhotoResult) {
    onChange([
      ...photos,
      {
        ...result,
        key: `${result.originalFile.name}-${photos.length}-${result.originalFile.size}`,
        previewUrl: URL.createObjectURL(result.annotatedBlob),
      },
    ]);
    setAnnotating(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function remove(key: string) {
    const going = photos.find((p) => p.key === key);
    if (going) URL.revokeObjectURL(going.previewUrl);
    onChange(photos.filter((p) => p.key !== key));
  }

  return (
    <div>
      {annotating && (
        <PhotoAnnotator
          file={annotating}
          onCancel={() => {
            setAnnotating(null);
            if (fileRef.current) fileRef.current.value = '';
          }}
          onSave={keep}
        />
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          Photos{' '}
          <span className="font-normal text-ink-subtle">
            {photos.length > 0
              ? `· ${photos.length} ready to attach`
              : '(optional)'}
          </span>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/webp"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) choose(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          Add photo
        </button>
      </div>

      {error && (
        <p className="mb-2 text-xs font-medium text-danger-600">{error}</p>
      )}

      {photos.length === 0 ? (
        <p className="text-xs text-ink-subtle">
          Add a photo and mark it up now — it is attached when you save the
          finding.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <li
              key={p.key}
              className="relative overflow-hidden rounded-lg border border-brand-200 bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt={`Annotated photo: ${p.originalFile.name}`}
                className="h-20 w-20 object-cover"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(p.key)}
                aria-label={`Remove photo ${p.originalFile.name}`}
                className="absolute right-0 top-0 bg-ink/70 px-1.5 py-0.5 text-xs font-bold text-white hover:bg-danger-600 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
