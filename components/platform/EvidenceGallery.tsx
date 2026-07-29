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
  /** SC-017: on the annotated copy, the id of the original it came from. */
  originalEvidenceId?: string | null;
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

  /**
   * SC-017 UX: an annotated photo and the original it was made from are ONE
   * piece of evidence in two files. Listing them as unrelated rows was confusing
   * once a finding had several photos, so they are grouped into a single card
   * and each part is explicitly labelled. Purely presentational — the storage
   * model (original untouched, annotated copy linked to it) is unchanged.
   */
  type Group = {
    key: string;
    original: EvidenceItem;
    annotated?: EvidenceItem;
  };
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const pairedOriginalIds = new Set(
    evidence
      .filter((e) => e.annotated && e.originalEvidenceId)
      .map((e) => e.originalEvidenceId as string)
      .filter((id) => byId.has(id)),
  );

  const groups: Group[] = [];
  for (const e of evidence) {
    // The original of a pair is rendered inside its annotated card, not twice.
    if (pairedOriginalIds.has(e.id)) continue;
    if (e.annotated && e.originalEvidenceId && byId.has(e.originalEvidenceId)) {
      groups.push({
        key: e.id,
        original: byId.get(e.originalEvidenceId)!,
        annotated: e,
      });
    } else {
      // An annotated copy whose original was removed still renders on its own.
      groups.push({ key: e.id, original: e });
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
          {groups.map((g) => {
            const pair = Boolean(g.annotated);
            return (
              <li
                key={g.key}
                className={cn(
                  'rounded-xl border bg-surface-sunken p-3',
                  pair ? 'border-brand-200 bg-brand-50/30' : 'border-line',
                )}
              >
                {pair && (
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                    <span aria-hidden>🔗</span> Annotated photo · 2 files
                  </p>
                )}
                <div
                  className={cn(
                    'space-y-2',
                    pair && 'divide-y divide-brand-200',
                  )}
                >
                  {/* Annotated version first — it is the one people look at. */}
                  {g.annotated && (
                    <EvidenceRow
                      item={g.annotated}
                      role="Annotated"
                      src={src}
                      canManage={canManage}
                      deletingId={deletingId}
                      onRemove={remove}
                    />
                  )}
                  <div className={cn(pair && 'pt-2')}>
                    <EvidenceRow
                      item={g.original}
                      role={pair ? 'Original' : undefined}
                      src={src}
                      canManage={canManage}
                      deletingId={deletingId}
                      onRemove={remove}
                    />
                  </div>
                </div>
                {pair && (
                  <p className="mt-2 text-[11px] text-ink-subtle">
                    The original is kept unchanged as the source record.
                  </p>
                )}
              </li>
            );
          })}
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

/**
 * One evidence file. `role` is set only when the file is part of an
 * original/annotated pair, so a lone upload is unlabelled as before.
 */
function EvidenceRow({
  item,
  role,
  src,
  canManage,
  deletingId,
  onRemove,
}: {
  item: EvidenceItem;
  role?: 'Original' | 'Annotated';
  src: (id: string) => string;
  canManage: boolean;
  deletingId: string | undefined;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex gap-3">
      <a
        href={src(item.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-surface print:h-auto print:w-64"
        title={item.isImage ? 'Open image' : 'Download file'}
      >
        {item.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src(item.id)}
            alt={item.fileName}
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
        {role && (
          <span
            className={cn(
              'mb-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
              role === 'Annotated'
                ? 'bg-brand-600 text-white'
                : 'bg-surface text-ink-muted ring-1 ring-line',
            )}
          >
            {role}
          </span>
        )}
        <a
          href={src(item.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-semibold text-brand-700 hover:underline"
          title={item.fileName}
        >
          {item.fileName}
        </a>
        <p className="text-xs text-ink-subtle">{formatBytes(item.size)}</p>
        <p className="mt-1 text-xs text-ink-subtle">
          {item.uploadedByName ?? 'Unknown'} ·{' '}
          {formatDateTimeUK(item.createdAt)}
        </p>
        <div className="mt-1.5 flex items-center gap-3 print:hidden">
          <a
            href={src(item.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            {item.isImage ? 'View' : 'Download'}
          </a>
          {canManage && (
            <button
              type="button"
              disabled={deletingId === item.id}
              onClick={() => onRemove(item.id)}
              className="text-xs font-semibold text-danger-700 hover:underline disabled:opacity-50"
            >
              {deletingId === item.id ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
