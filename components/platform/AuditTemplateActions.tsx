'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

/** Manage actions for one audit template (SC-013): edit / activate / delete. */
export function AuditTemplateActions({
  id,
  active,
  isSystem,
}: {
  id: string;
  active: boolean;
  isSystem: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/audit-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not update the template.');
        return;
      }
      toast.success(ok);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/audit-templates/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not delete the template.');
        return;
      }
      toast.success('Template deleted.');
      setConfirmDelete(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/platform/dashboard/audits/templates/${id}/edit`}
        className="text-sm font-semibold text-brand-700 hover:underline"
      >
        Edit
      </Link>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          patch(
            { active: !active },
            active ? 'Template deactivated.' : 'Template activated.',
          )
        }
        className="text-sm font-semibold text-ink-muted hover:underline disabled:opacity-50"
      >
        {active ? 'Deactivate' : 'Activate'}
      </button>
      {!isSystem && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
          className="text-sm font-semibold text-danger-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this template?"
        message="Existing audits created from it are unaffected. This cannot be undone."
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
