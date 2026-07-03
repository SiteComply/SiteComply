'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * Delete action for a document. Opens a confirmation dialog, then DELETEs via
 * the API (which removes both the blob file and the metadata row after RBAC +
 * site-scope checks).
 *
 * `variant` controls presentation and post-delete behaviour:
 *  - "button" (default) — bordered button used on the detail page; on success
 *    it returns to the document list.
 *  - "link" — a compact text link used inline in the list table; on success it
 *    just refreshes the list in place (preserving any active filters).
 */
export function DocumentDeleteButton({
  documentId,
  title,
  variant = 'button',
}: {
  documentId: string;
  title: string;
  variant?: 'button' | 'link';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function remove() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/platform/documents/${documentId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setOpen(false);
        if (variant === 'button') {
          // Leaving the (now-deleted) detail page — go back to the list.
          router.push('/platform/dashboard/documents');
        }
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not delete this document. Please try again.');
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
        className={
          variant === 'link'
            ? 'text-sm font-semibold text-danger-600 hover:underline'
            : 'rounded-xl border border-danger-600 px-4 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50'
        }
      >
        Delete
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this document?"
        message={
          error ??
          `This permanently deletes “${title}” and its file. This cannot be undone.`
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
