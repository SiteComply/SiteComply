'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * Delete action for an audit (detail page). Opens a confirmation dialog, then
 * DELETEs via the API — which permanently removes the audit and all its findings
 * after the delete-role + site-scope checks — and returns to the audits list.
 * Rendered only for roles allowed to delete audits.
 */
export function AuditDeleteButton({
  auditId,
  title,
}: {
  auditId: string;
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
      const res = await fetch(`/api/platform/audits/${auditId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setOpen(false);
        router.push('/platform/dashboard/audits');
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not delete this audit. Please try again.');
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
        Delete audit
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this audit?"
        message={
          error ??
          `This permanently deletes “${title}” and all of its findings. This cannot be undone. Referenced documents are not affected.`
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
