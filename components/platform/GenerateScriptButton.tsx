'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Queue a script generation.
 *
 * It only QUEUES: the scheduler runs the model, so this returns immediately and
 * the page shows "Script generating" until the next tick. Disabled when the
 * readiness check has blocked the project, because the service refuses it
 * anyway and a button that fails on press is a worse explanation than one that
 * cannot be pressed.
 */
export function GenerateScriptButton({
  siteId,
  disabled,
}: {
  siteId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/induction-video`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not start a generation.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={generate}
        disabled={disabled || busy}
        title={
          disabled
            ? 'Add the missing information above before generating'
            : undefined
        }
        className="rounded-lg bg-safe-500 px-3 py-2 text-sm font-semibold text-white hover:bg-safe-600 disabled:opacity-40"
      >
        {busy ? 'Starting…' : 'Generate script'}
      </button>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
