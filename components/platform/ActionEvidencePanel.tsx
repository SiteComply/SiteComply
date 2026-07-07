'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTimeUK } from '@/lib/datetime';
import type { EvidenceView } from '@/services/actions/actionEvidenceService';

/**
 * Evidence (photos / documents) attached to an action. Anyone who can see the
 * action sees the list and can view/download each file; roles with the actions
 * "edit" permission can upload new evidence and remove existing files. Images
 * render as thumbnails that open full size; other files show as a download row.
 */
export function ActionEvidencePanel({
  actionId,
  evidence,
  canManage,
}: {
  actionId: string;
  evidence: EvidenceView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [deletingId, setDeletingId] = useState<string | undefined>();

  const src = (id: string) => `/api/platform/actions/${actionId}/evidence/${id}/download`;

  async function upload(file: File) {
    setBusy(true);
    setError(undefined);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/platform/actions/${actionId}/evidence`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Upload failed. Please try again.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    setError(undefined);
    try {
      const res = await fetch(`/api/platform/actions/${actionId}/evidence/${id}`, {
        method: 'DELETE',
      });
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
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
          Evidence
        </h2>
        {canManage && (
          <div className="flex flex-col items-end gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
              className="hidden"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? 'Uploading…' : 'Upload evidence'}
            </button>
          </div>
        )}
      </div>

      {error && <p className="mb-3 text-sm font-medium text-danger-600">{error}</p>}

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
                className="block h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-surface"
                title={e.isImage ? 'Open image' : 'Download file'}
              >
                {e.isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src(e.id)}
                    alt={e.fileName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl" aria-hidden>
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
                <p className="text-xs text-ink-subtle">{formatBytes(e.size)}</p>
                <p className="mt-1 text-xs text-ink-subtle">
                  {e.uploadedByName ?? 'Unknown'} · {formatDateTimeUK(e.createdAt)}
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
                      className="text-xs font-semibold text-danger-700 hover:underline disabled:opacity-50"
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
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
