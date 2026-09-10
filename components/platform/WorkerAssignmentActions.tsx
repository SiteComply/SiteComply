'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignmentRow } from '@/services/workerAccess/workerAssignmentService';

/**
 * Per-worker access actions, for the Workers rail.
 *
 * These used to live in a second worker list at the bottom of the page, which
 * showed the same people as the roster above it in a different vocabulary — and
 * put an Approve button beside every ordinary worker, for a step that no longer
 * exists. The roster is the one place workers are viewed; this is the one place
 * they are managed, and it is reached by selecting them there.
 *
 * Permissions are UNCHANGED. The server checks `canManageWorkerAccess` plus site
 * scope on every call regardless of what is rendered — moving the buttons moves
 * no authority. `canManage` only decides whether they are shown.
 */

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  CONTRACTOR: 'Contractor',
  SUPERVISOR: 'Supervisor',
  CLIENT_REP: 'Client representative',
};

/** yyyy-mm-dd for a date input, from the stored London-midnight instant. */
function toInput(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

const BTN =
  'rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40';
const FIELD =
  'mt-0.5 block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink';

export function WorkerAssignmentActions({
  siteId,
  row,
  canManage,
  otherSites,
}: {
  siteId: string;
  row: AssignmentRow;
  canManage: boolean;
  otherSites: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [detail, setDetail] = useState({
    role: row.role ?? '',
    startDate: row.startDate ? toInput(row.startDate) : '',
    endDate: row.endDate ? toInput(row.endDate) : '',
  });

  if (!canManage) return null;

  async function call(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/worker-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not complete that change.');
        return;
      }
      setNotice(ok);
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /*
   * Approval appears ONLY where it is a control:
   *
   *   SUSPENDED — access was withdrawn; "Reinstate" restores it.
   *   REMOVED   — removed from the project; "Approve" puts them back.
   *   INVITED   — the only way to reach this now is a transfer in from another
   *               site, which the receiving manager must accept.
   *
   * An ordinary worker is ACTIVE from the moment they are invited, so none of
   * this renders for them.
   */
  const needsApproval = row.status !== 'ACTIVE';
  const approveLabel = row.status === 'SUSPENDED' ? 'Reinstate' : 'Approve';
  const approveAction = row.status === 'SUSPENDED' ? 'reinstate' : 'approve';

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
        Manage access
      </p>

      <div className="flex flex-wrap gap-2">
        {needsApproval ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              call(
                { action: approveAction, assignmentId: row.id },
                `${row.workerName} can now check in.`,
              )
            }
            className={BTN}
          >
            {approveLabel}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              call(
                { action: 'suspend', assignmentId: row.id },
                `${row.workerName}'s access is suspended.`,
              )
            }
            className={BTN}
          >
            Suspend
          </button>
        )}

        <button type="button" onClick={() => setEditing((v) => !v)} className={BTN}>
          {editing ? 'Close' : 'Role & dates'}
        </button>

        {row.status !== 'REMOVED' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  `Remove ${row.workerName} from this project?\n\nTheir check-ins, inductions and permits here are kept.`,
                )
              ) {
                return;
              }
              call(
                { action: 'remove', assignmentId: row.id },
                `${row.workerName} removed from this project.`,
              );
            }}
            className="rounded-lg border border-danger-500/40 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-40"
          >
            Remove
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <label className="block text-xs text-ink-muted">
            Role
            <select
              value={detail.role}
              onChange={(e) => setDetail((d) => ({ ...d, role: e.target.value }))}
              className={FIELD}
            >
              <option value="">Not set</option>
              {Object.entries(ROLE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-ink-muted">
            Access from
            <input
              type="date"
              value={detail.startDate}
              onChange={(e) => setDetail((d) => ({ ...d, startDate: e.target.value }))}
              className={FIELD}
            />
          </label>
          <label className="block text-xs text-ink-muted">
            Access to (inclusive)
            <input
              type="date"
              value={detail.endDate}
              onChange={(e) => setDetail((d) => ({ ...d, endDate: e.target.value }))}
              className={FIELD}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              call(
                { action: 'setDetails', assignmentId: row.id, ...detail },
                `Updated ${row.workerName}.`,
              )
            }
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Save
          </button>
          <p className="text-xs text-ink-subtle">
            The role is recorded for reporting only — it does not change what this
            worker can see or do. Access runs to the END of the “access to” day.
          </p>

          {otherSites.length > 0 && row.status !== 'REMOVED' ? (
            <div className="space-y-2 border-t border-line pt-3">
              <label className="block text-xs text-ink-muted">
                Transfer to another project
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className={FIELD}
                >
                  <option value="">Choose a project…</option>
                  {otherSites.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !transferTo}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Transfer ${row.workerName} to the selected project?\n\nThey will need approving there before they can check in, and are removed from this project. Their history here is kept.`,
                    )
                  ) {
                    return;
                  }
                  call(
                    { action: 'transfer', assignmentId: row.id, toSiteId: transferTo },
                    `${row.workerName} transferred — they need approving on the destination project.`,
                  );
                }}
                className={BTN}
              >
                Transfer
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
      {notice ? <p className="mt-2 text-xs text-safe-700">{notice}</p> : null}
    </div>
  );
}
