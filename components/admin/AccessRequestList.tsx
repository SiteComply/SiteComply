'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatDateTimeUK } from '@/lib/datetime';

export interface AccessRequestRow {
  id: string;
  fullName: string;
  companyName: string;
  email: string;
  mobile: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string; // ISO
  reviewedAt: string | null; // ISO
  reviewedBy: string | null; // approving/rejecting admin's name
  linkedUserEmail: string | null; // Platform User created on approval
}

/**
 * Admin list of Platform Access Requests for a single status tab. Pending
 * requests can be Approved or Rejected; decided requests can be reopened.
 */
export function AccessRequestList({ requests }: { requests: AccessRequestRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | undefined>();
  // The decided request queued for permanent deletion (drives the confirm modal).
  const [toRemove, setToRemove] = useState<AccessRequestRow | undefined>();

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/platform-access-requests/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/platform-access-requests/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setToRemove(undefined);
        router.refresh();
      }
    } finally {
      setBusyId(undefined);
    }
  }

  if (requests.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-ink-muted">
        No requests in this tab.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {requests.map((r) => {
        const busy = busyId === r.id;
        return (
          <li
            key={r.id}
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold text-ink">{r.fullName}</span>
                <span className="text-sm text-ink-subtle">· {r.companyName}</span>
              </div>
              <p className="mt-0.5 truncate text-sm text-ink-subtle">
                {r.email} · {r.mobile}
              </p>
              {r.reason && (
                <p className="mt-1 text-sm text-ink">
                  <span className="text-ink-subtle">Reason:</span> {r.reason}
                </p>
              )}
              <p className="mt-1 text-xs text-ink-subtle">
                Requested {formatDateTimeUK(r.createdAt)}
              </p>
              {r.status !== 'PENDING' && r.reviewedAt && (
                <p className="mt-1 text-xs text-ink-subtle">
                  {r.status === 'APPROVED' ? 'Approved' : 'Rejected'}{' '}
                  {formatDateTimeUK(r.reviewedAt)}
                  {r.reviewedBy ? ` by ${r.reviewedBy}` : ''}
                  {r.status === 'APPROVED' && r.linkedUserEmail
                    ? ` · Platform user: ${r.linkedUserEmail}`
                    : ''}
                </p>
              )}
            </div>

            <div className="flex shrink-0 gap-2">
              {r.status === 'PENDING' ? (
                <>
                  <Link
                    href={`/admin/platform-access-requests/${r.id}/approve`}
                    className="touch-target inline-flex items-center rounded-lg border border-safe-500 px-3 py-2 text-sm font-semibold text-safe-700 hover:bg-safe-50"
                  >
                    Approve
                  </Link>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStatus(r.id, 'REJECTED')}
                    className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStatus(r.id, 'PENDING')}
                    className="touch-target inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
                  >
                    Reopen
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setToRemove(r)}
                    className="touch-target inline-flex items-center rounded-lg border border-danger-600 px-3 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}

      <ConfirmDialog
        open={!!toRemove}
        title="Remove this access request?"
        message={
          toRemove
            ? `This permanently deletes the ${toRemove.status.toLowerCase()} request from ${toRemove.fullName} (${toRemove.email}). This cannot be undone. Any platform account already created from it is not affected.`
            : undefined
        }
        confirmLabel="Remove permanently"
        confirmVariant="danger"
        busy={!!toRemove && busyId === toRemove.id}
        onConfirm={() => toRemove && remove(toRemove.id)}
        onCancel={() => setToRemove(undefined)}
      />
    </ul>
  );
}
