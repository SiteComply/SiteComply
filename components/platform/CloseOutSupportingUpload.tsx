'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const CATEGORIES = [
  { value: 'GENERAL', label: 'General' },
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'RAMS', label: 'RAMS' },
  { value: 'INSURANCE', label: 'Insurance' },
];

/**
 * SC-024 Phase 2 — add supporting documentation before generating.
 *
 * This posts to the ordinary documents endpoint rather than a bespoke close-out
 * upload: the file lands in the project's Documents module, where it is subject
 * to the same permissions, validation and retention as everything else, and is
 * picked up as an appendix by the next pack generated. A private "close-out
 * only" file store would be a second copy of the truth with none of those
 * controls.
 */
export function CloseOutSupportingUpload({ siteId }: { siteId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);

    const form = new FormData();
    form.set('file', file);
    form.set('title', title.trim() || file.name);
    form.set('category', category);
    form.set('jobSiteId', siteId);

    try {
      const res = await fetch('/api/platform/documents', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(
          data.errors?.file ??
            data.errors?.category ??
            data.error ??
            'Could not upload that file.',
        );
        return;
      }
      setDone(`${title.trim() || file.name} added.`);
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      // Refresh so the new file shows in the live document counts immediately.
      router.refresh();
    } catch {
      setError('Could not upload that file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={upload}
      className="mt-6 rounded-2xl border border-line bg-surface p-5"
    >
      <h2 className="text-base font-bold text-ink">
        Add supporting documentation
      </h2>
      <p className="mb-3 text-sm text-ink-muted">
        Upload anything still missing before you generate — certificates,
        sign-off sheets, warranties. Files are added to this project&rsquo;s
        documents and included as numbered appendices in the pack and ZIP
        export.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-ink">File</span>
          <input
            ref={fileRef}
            type="file"
            className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-ink">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Defaults to the filename"
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-ink">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? 'Uploading…' : 'Upload document'}
        </button>
        {done ? <p className="text-sm text-brand-700">{done}</p> : null}
        {error ? <p className="text-sm text-danger-600">{error}</p> : null}
      </div>
    </form>
  );
}
