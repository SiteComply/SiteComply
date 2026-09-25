'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Permanently delete an induction script version.
 *
 * Offered only for versions that never entered the record — unapproved, never
 * published, never watched. The service decides that, not this button: it is the
 * same refusal in both tiers, and a control that is merely hidden is not a guard.
 *
 * ── IT ASKS, BECAUSE IT CANNOT BE UNDONE ──────────────────────────────────
 *
 * Two presses rather than a modal. A confirmation dialog for a draft would be
 * heavier than the act deserves, but a single click that destroys work somebody
 * generated is worse. The second press says what will happen.
 *
 * `afterHref` is for the version page, where deleting removes the thing being
 * looked at — it navigates to the project instead of refreshing into a 404. The
 * project list leaves it unset and just refreshes in place.
 */
export function DeleteVersionButton({
  endpoint,
  version,
  afterHref,
  compact = false,
}: {
  /** The tier's route for this version. */
  endpoint: string;
  version: number;
  afterHref?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not delete this version.');
        setArmed(false);
        return;
      }
      if (afterHref) {
        router.push(afterHref);
      }
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!armed) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className={
            compact
              ? 'text-xs font-semibold text-danger-700 hover:underline'
              : 'rounded-lg border border-danger-500/40 bg-surface px-3 py-2 text-sm font-semibold text-danger-700 hover:bg-danger-50'
          }
        >
          Delete version {version}
        </button>
        {error && (
          <p role="alert" className="max-w-sm text-xs font-medium text-danger-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">Delete permanently?</span>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger-700 disabled:opacity-40"
        >
          {busy ? 'Deleting…' : 'Yes, delete it'}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="text-xs font-semibold text-ink-muted hover:text-ink"
        >
          Keep it
        </button>
      </div>
      {error && (
        <p role="alert" className="max-w-sm text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
