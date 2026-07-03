'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * Delete action for the action detail page. Opens a confirmation dialog, then
 * DELETEs via the API — which enforces the actions "edit" permission and the
 * site-scope boundary — and returns to the actions register. Rendered only for
 * roles allowed to edit/delete actions.
 */
export function ActionDeleteButton({
  actionId,
  title,
}: {
  actionId: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function remove() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/platform/actions/${actionId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setOpen(false);
        router.push('/platform/dashboard/actions');
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not delete this action. Please try again.');
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-danger-600 px-4 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50"
      >
        Delete action
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this action?"
        message={
          error ??
          `This permanently deletes “${title}”. This cannot be undone. Any audit finding it was raised from is not affected.`
        }
        confirmLabel="Delete permanently"
        confirmVariant="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => {
          if (!busy) {
            setOpen(false);
            setError(undefined);
          }
        }}
      />
    </>
  );
}
