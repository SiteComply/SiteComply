'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { formatDateTimeUK } from '@/lib/datetime';
import { PhotoAnnotator } from '@/components/platform/PhotoAnnotator';
import { isAnnotatable } from '@/lib/imagePrep';
import type { AnnotationDocument } from '@/services/annotations/annotationTypes';

export interface EvidenceItem {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  /** SC-017: true for the annotated copy of a photo. */
  annotated?: boolean;
  uploadedByName: string | null;
  createdAt: string; // ISO
}

const ACCEPT =
  'image/jpeg,image/png,image/heic,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain';

/**
 * Shared evidence gallery for photos / documents — used by both Action evidence
 * and Audit Finding evidence so the UI and behaviour stay identical. `basePath`
 * is the evidence collection endpoint (e.g. /api/platform/actions/<id>/evidence
 * or /api/platform/audit-findings/<id>/evidence): upload POSTs there, each file
 * downloads from `${basePath}/<id>/download`, and remove DELETEs `${basePath}/<id>`.
 * Images render as thumbnails that open full size; other files show a download
 * row. Upload/remove appear only when `canManage`; without it the gallery is
 * read-only (view/download).
 */
export function EvidenceGallery({
  basePath,
  evidence,
  canManage,
  label = 'Evidence',
}: {
  basePath: string;
  evidence: EvidenceItem[];
  canManage: boolean;
  label?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [deletingId, setDeletingId] = useState<string | undefined>();
  // SC-017: the photo currently open in the annotator (null = annotator closed).
  const [annotating, setAnnotating] = useState<File | null>(null);

  const src = (id: string) => `${basePath}/${id}/download`;

  async function upload(file: File, extra?: Record<string, string>) {
    setBusy(true);
    setError(undefined);
    try {
      const fd = new FormData();
      fd.append('file', file);
      for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
      const res = await fetch(basePath, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Upload failed. Please try again.');
        return null;
      }
      return (data.id as string) ?? null;
    } catch {
      setError('Network problem. Please try again.');
      return null;
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /**
   * SC-017: a chosen photo goes through the annotator first; anything else (PDF,
   * Word, …) uploads straight away as before.
   */
  function chooseFile(file: File) {
    if (isAnnotatable(file)) {
      setAnnotating(file);
      return;
    }
    void upload(file).then((id) => {
      if (id) router.refresh();
    });
  }

  /**
   * Save order matters: the ORIGINAL is uploaded first so the annotated copy can
   * point back at it. Both are kept — the untouched photo stays part of the
   * record, and the annotated copy carries the editable annotation data.
   */
  async function saveAnnotated(result: {
    annotatedBlob: Blob;
    originalFile: File;
    document: AnnotationDocument;
  }) {
    const originalId = await upload(result.originalFile);
    if (!originalId) return;

    const base = result.originalFile.name.replace(/\.[^.]+$/, '') || 'photo';
    const annotatedFile = new File(
      [result.annotatedBlob],
      `${base}-annotated.jpg`,
      { type: 'image/jpeg' },
    );
    await upload(annotatedFile, {
      annotated: 'true',
      originalEvidenceId: originalId,
      annotationData: JSON.stringify(result.document),
    });
    setAnnotating(null);
    router.refresh();
  }

  async function remove(id: string) {
    setDeletingId(id);
    setError(undefined);
    try {
      const res = await fetch(`${basePath}/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not remove the file.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setDeletingId(undefined);
    }
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
          onSave={saveAnnotated}
        />
      )}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
          {label}
        </h3>
        {canManage && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) chooseFile(f);
              }}
              className="hidden"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50 print:hidden"
            >
              {busy ? 'Uploading…' : 'Upload evidence'}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="mb-3 text-sm font-medium text-danger-600">{error}</p>
      )}

      {evidence.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          No evidence uploaded yet.
          {canManage && ' Use “Upload evidence” to add a photo or document.'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {evidence.map((e) => (
            <li
              key={e.id}
              className="flex gap-3 rounded-xl border border-line bg-surface-sunken p-3"
            >
              <a
                href={src(e.id)}
                target="_blank"
                rel="noopener noreferrer"
                // SC-017: printable views are browser print-to-PDF, so an
                // annotated photo must print big enough to read the annotations
                // rather than as a 64px thumbnail.
                className="block h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-surface print:h-auto print:w-64"
                title={e.isImage ? 'Open image' : 'Download file'}
              >
                {e.isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src(e.id)}
                    alt={e.fileName}
                    className="h-full w-full object-cover print:h-auto print:w-full print:object-contain"
                  />
                ) : (
                  <span
                    className="flex h-full w-full items-center justify-center text-2xl"
                    aria-hidden
                  >
                    📄
                  </span>
                )}
              </a>
              <div className="min-w-0 flex-1">
                <a
                  href={src(e.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm font-semibold text-brand-700 hover:underline"
                  title={e.fileName}
                >
                  {e.fileName}
                </a>
                <p className="text-xs text-ink-subtle">
                  {formatBytes(e.size)}
                  {e.annotated && (
                    <span className="ml-2 inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                      Annotated
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-ink-subtle">
                  {e.uploadedByName ?? 'Unknown'} ·{' '}
                  {formatDateTimeUK(e.createdAt)}
                </p>
                <div className="mt-1.5 flex items-center gap-3">
                  <a
                    href={src(e.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-brand-700 hover:underline"
                  >
                    {e.isImage ? 'View' : 'Download'}
                  </a>
                  {canManage && (
                    <button
                      type="button"
                      disabled={deletingId === e.id}
                      onClick={() => remove(e.id)}
                      className={cn(
                        'text-xs font-semibold text-danger-700 hover:underline disabled:opacity-50',
                      )}
                    >
                      {deletingId === e.id ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
