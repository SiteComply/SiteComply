'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SC-024 Phase 2 — build / download the ZIP export for one pack revision.
 *
 * The build is deliberately explicit rather than automatic on generation: it
 * copies every original file on the project, which on a large job is minutes of
 * work and hundreds of megabytes. Someone printing a pack to PDF should not pay
 * for an archive they did not ask for.
 */
export function CloseOutArchiveButton({
  siteId,
  packId,
  zip,
}: {
  siteId: string;
  packId: string;
  zip: {
    generatedAt: string;
    sizeBytes: number;
    fileCount: number;
    truncated: boolean;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const href = `/api/platform/sites/${siteId}/close-out/${packId}/archive`;

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(href, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not build the archive.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not build the archive.');
    } finally {
      setBusy(false);
    }
  }

  const mb = zip ? Math.max(0.1, zip.sizeBytes / 1024 / 1024) : 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {zip ? (
          <a
            href={href}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
          >
            Download ZIP ({mb.toFixed(1)} MB)
          </a>
        ) : null}
        <button
          type="button"
          onClick={build}
          disabled={busy}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-60"
        >
          {busy
            ? 'Building…'
            : zip
              ? 'Rebuild ZIP'
              : 'Generate ZIP (pack + original files)'}
        </button>
      </div>

      {zip ? (
        <p className="text-right text-xs text-ink-subtle">
          {zip.fileCount} files · built{' '}
          {new Date(zip.generatedAt).toLocaleString('en-GB')}
        </p>
      ) : null}

      {/* An archive that quietly dropped files is worse than one that says so. */}
      {zip?.truncated ? (
        <p className="max-w-xs rounded border border-hivis-500/40 bg-hivis-500/10 px-2 py-1 text-right text-xs text-ink-muted">
          Size limit reached — some original files are listed in the manifest
          but not included. See INCOMPLETE-README.txt in the archive.
        </p>
      ) : null}

      {error ? (
        <p className="max-w-xs text-right text-xs text-danger-600">{error}</p>
      ) : null}
    </div>
  );
}
