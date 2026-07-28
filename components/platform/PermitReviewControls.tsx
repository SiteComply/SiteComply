'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { REJECTION_REASON_MAX } from '@/services/permits/permitConstants';

/**
 * Manager review actions for a permit (SC-009). Rendered only when the permit is
 * in an actionable state. Approve/Reject are shown only to approver-role users
 * (`canApprove`); Under review / Close follow the `permits` edit permission.
 */
export function PermitReviewControls({
  permitId,
  status,
  canApprove,
}: {
  permitId: string;
  status: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [reason, setReason] = useState('');

  const awaiting = status === 'SUBMITTED' || status === 'UNDER_REVIEW';
  const closable =
    status === 'APPROVED' || status === 'UNDER_REVIEW' || status === 'EXPIRED';

  async function send(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/permits/${permitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not update the permit.');
        return;
      }
      toast.success(ok);
      setMode('idle');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!awaiting && !closable) return null;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="text-sm font-semibold text-ink">Review</p>

      {mode === 'approve' ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink">Valid from</span>
              <input
                type="datetime-local"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <span className="text-xs text-ink-subtle">
                Leave blank for now.
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink">Valid until</span>
              <input
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                send(
                  {
                    action: 'approve',
                    validFrom: validFrom || null,
                    validUntil: validUntil || null,
                  },
                  'Permit approved.',
                )
              }
              disabled={busy}
            >
              {busy ? 'Approving…' : 'Confirm approval'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setMode('idle')}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : mode === 'reject' ? (
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink">Reason for rejection</span>
            <textarea
              rows={3}
              maxLength={REJECTION_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this permit can’t be approved."
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={() =>
                send({ action: 'reject', reason }, 'Permit rejected.')
              }
              disabled={busy || reason.trim().length < 3}
            >
              {busy ? 'Rejecting…' : 'Confirm rejection'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setMode('idle')}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === 'SUBMITTED' && (
            <Button
              variant="secondary"
              onClick={() => send({ action: 'review' }, 'Marked under review.')}
              disabled={busy}
            >
              Mark under review
            </Button>
          )}
          {awaiting && canApprove && (
            <>
              <Button onClick={() => setMode('approve')} disabled={busy}>
                Approve
              </Button>
              <Button
                variant="danger"
                onClick={() => setMode('reject')}
                disabled={busy}
              >
                Reject
              </Button>
            </>
          )}
          {awaiting && !canApprove && (
            <p className="text-sm text-ink-subtle">
              Your role can review permits but not approve them.
            </p>
          )}
          {closable && (
            <Button
              variant="secondary"
              onClick={() => send({ action: 'close' }, 'Permit closed.')}
              disabled={busy}
            >
              Close permit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
