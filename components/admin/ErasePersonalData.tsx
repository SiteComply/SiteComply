'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

/**
 * Admin control to erase a worker's personal data (UK GDPR right to erasure).
 * Anonymises the worker's identifiers across all their records; the anonymised
 * compliance history is retained. Requires an explicit confirmation.
 */
export function ErasePersonalData({
  workerId,
  erased,
}: {
  workerId: string;
  erased: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (erased) {
    return (
      <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-subtle">
        This worker’s personal data has been erased.
      </p>
    );
  }

  async function erase() {
    if (
      !window.confirm(
        'Erase this worker’s personal data? Their name, mobile and CSCS details ' +
          'will be anonymised across all records. This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workers/${workerId}/erase`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not erase. Please try again.');
        return;
      }
      toast.success('Personal data erased.');
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={erase}
      disabled={busy}
      className="touch-target inline-flex items-center rounded-lg border border-danger-500/40 px-3 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50 disabled:opacity-50"
    >
      {busy ? 'Erasing…' : 'Erase personal data (UK GDPR)'}
    </button>
  );
}
