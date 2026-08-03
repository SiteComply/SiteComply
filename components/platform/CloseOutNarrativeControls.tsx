'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SC-024 Phase 3 — generate or remove the AI narrative for a pack.
 *
 * Generation is explicit and reversible. A close-out pack is a document someone
 * puts their name to, so the prose is offered rather than imposed: it is never
 * written automatically at generation time, and it can be removed in one click
 * if the author does not want it.
 */
export function CloseOutNarrativeControls({
  siteId,
  packId,
  hasNarrative,
}: {
  siteId: string;
  packId: string;
  hasNarrative: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'gen' | 'del' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const href = `/api/platform/sites/${siteId}/close-out/${packId}/narrative`;

  async function run(method: 'POST' | 'DELETE') {
    setBusy(method === 'POST' ? 'gen' : 'del');
    setError(null);
    try {
      const res = await fetch(href, { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not complete that.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-ink">
            AI narrative{' '}
            <span className="text-xs font-medium text-ink-subtle">
              optional
            </span>
          </h2>
          <p className="text-sm text-ink-muted">
            Writes a descriptive executive summary and a short narrative for
            each section, from the records in this pack. It describes what the
            records contain — it never assesses, certifies or approves
            compliance, and everything it writes is labelled.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => run('POST')}
            disabled={busy !== null}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {busy === 'gen'
              ? 'Writing…'
              : hasNarrative
                ? 'Regenerate'
                : 'Generate narrative'}
          </button>
          {hasNarrative ? (
            <button
              type="button"
              onClick={() => run('DELETE')}
              disabled={busy !== null}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {busy === 'del' ? 'Removing…' : 'Remove'}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}
    </div>
  );
}
