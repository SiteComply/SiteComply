'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { TEMPLATE_NAME_MAX } from '@/services/audits/auditTemplateConstants';

/**
 * Save an audit as a reusable template (SC-013). Captures the audit's checklist
 * items (or, if none, its findings) into a new organisation-level template.
 * Opens a small inline naming form on click.
 */
export function SaveAuditAsTemplateButton({
  auditId,
  defaultName,
}: {
  auditId: string;
  defaultName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/audits/${auditId}/save-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save the template.');
        return;
      }
      toast.success('Saved as a reusable template.');
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
      >
        Save as template
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-line bg-surface p-3 shadow-card sm:w-80">
      <p className="text-sm font-semibold text-ink">
        Save as a reusable template
      </p>
      <p className="text-xs text-ink-subtle">
        Adds this audit’s checklist to the shared library for reuse across
        sites.
      </p>
      <TextField
        label="Template name"
        value={name}
        maxLength={TEMPLATE_NAME_MAX}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || name.trim().length < 2}>
          {busy ? 'Saving…' : 'Save template'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
