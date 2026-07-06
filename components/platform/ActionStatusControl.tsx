'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ACTION_STATUSES } from '@/services/actions/actionConstants';

/**
 * Status workflow control for an action detail page. Shown only to roles with
 * the actions "edit" permission. Selecting Open/In progress applies immediately;
 * selecting Completed reveals a REQUIRED completion note before submitting. All
 * changes POST to the status endpoint (which records the timeline entry).
 */
export function ActionStatusControl({
  actionId,
  status,
}: {
  actionId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [completing, setCompleting] = useState(false);
  const [note, setNote] = useState('');

  async function post(next: string, completionNote?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/platform/actions/${actionId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, note: completionNote }),
      });
      if (res.ok) {
        setCompleting(false);
        setNote('');
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not update the status. Please try again.');
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function onPick(next: string) {
    if (next === status || busy) return;
    if (next === 'COMPLETED') {
      setCompleting(true);
      setError(undefined);
      return;
    }
    setCompleting(false);
    post(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        Update status
      </p>
      <div className="flex flex-wrap gap-2">
        {ACTION_STATUSES.map((s) => {
          const active = s.value === status;
          return (
            <button
              key={s.value}
              type="button"
              disabled={active || busy}
              onClick={() => onPick(s.value)}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm font-semibold disabled:cursor-default',
                active
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-line text-ink-muted hover:bg-surface-sunken disabled:opacity-50',
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {completing && (
        <div className="mt-2 space-y-2 rounded-xl border border-line bg-surface-sunken p-3">
          <label className="block text-sm font-semibold text-ink">
            Completion note (required)
          </label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Summarise what was done to complete this action…"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || note.trim() === ''}
              onClick={() => post('COMPLETED', note)}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Mark completed'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCompleting(false);
                setNote('');
                setError(undefined);
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm font-medium text-danger-600">{error}</p>}
    </div>
  );
}
