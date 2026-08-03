'use client';

import type { SiteStatusValue } from '@/services/sites/siteStatusFilter';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

/**
 * Director-only "Archive site" / "Reactivate site" action for the Site Details
 * page — the dedicated, discoverable status control (distinct from, and shown
 * alongside, the Edit Site button). Active sites can be archived and archived
 * sites reactivated, each behind an explicit confirmation that explains the
 * impact. On success the page refreshes so the status pill and every derived view
 * update immediately.
 */
export function SiteStatusButton({
  siteId,
  status,
}: {
  siteId: string;
  status: SiteStatusValue;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const archiving = status === 'ACTIVE';
  const target = archiving ? 'ARCHIVED' : 'ACTIVE';

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? 'Could not update the site. Please try again.',
        );
        return;
      }
      setOpen(false);
      toast.success(archiving ? 'Site archived.' : 'Site reactivated.');
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'touch-target inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold shadow-sm transition-colors',
          archiving
            ? 'border border-line bg-surface text-ink-muted hover:bg-surface-sunken'
            : 'bg-safe-500 text-white shadow-safe-600/20 hover:bg-safe-600',
        )}
      >
        {archiving ? 'Archive site' : 'Reactivate site'}
      </button>

      <ConfirmDialog
        open={open}
        title={archiving ? 'Archive this site?' : 'Reactivate this site?'}
        message={
          archiving
            ? 'Workers will no longer see this site for check-in. All of its history — check-ins, reports, audits, actions and documents — is kept and stays available for reporting. You can reactivate it at any time.'
            : 'This site becomes active again and available to workers for check-in. Its existing history is unchanged.'
        }
        confirmLabel={
          busy ? 'Saving…' : archiving ? 'Archive site' : 'Reactivate site'
        }
        cancelLabel="Cancel"
        confirmVariant="primary"
        busy={busy}
        onConfirm={confirm}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
      />
    </>
  );
}
