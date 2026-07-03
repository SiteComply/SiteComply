'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ACTION_STATUSES } from '@/services/actions/actionConstants';

/**
 * Status workflow control for an action detail page. Shown only to roles with
 * the actions "edit" permission. Selecting a status POSTs to the status endpoint
 * (which sets completedAt when completing) and refreshes.
 */
export function ActionStatusControl({
  actionId,
  status,
}: {
  actionId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function change(next: string) {
    if (next === status || busy) return;
    setBusy(next);
    setError(undefined);
    try {
      const res = await fetch(`/api/platform/actions/${actionId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not update the status. Please try again.');
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(undefined);
    }
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
              disabled={active || !!busy}
              onClick={() => change(s.value)}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm font-semibold disabled:cursor-default',
                active
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-line text-ink-muted hover:bg-surface-sunken disabled:opacity-50',
              )}
            >
              {busy === s.value ? 'Saving…' : s.label}
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm font-medium text-danger-600">{error}</p>}
    </div>
  );
}
