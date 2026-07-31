'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTimeUK } from '@/lib/datetime';
import type { AssignmentRow } from '@/services/workerAccess/workerAssignmentService';

/**
 * SC-023 Phase 1 — invite workers to a project and control their access.
 *
 * The enforcement switch sits at the TOP with its current state spelled out,
 * because everything below means something different depending on it: with
 * enforcement off these are records, with it on they are the gate.
 */

/** yyyy-mm-dd for a date input, from the stored London-midnight instant. */
function toInput(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  CONTRACTOR: 'Contractor',
  SUPERVISOR: 'Supervisor',
  CLIENT_REP: 'Client representative',
};

const WINDOW_NOTE: Record<string, string> = {
  pending: 'Access has not started yet',
  expired: 'Access has ended',
};

const STATUS_LABEL: Record<string, string> = {
  INVITED: 'Awaiting approval',
  ACTIVE: 'Approved',
  SUSPENDED: 'Suspended',
  REMOVED: 'Removed',
};

const STATUS_CLASS: Record<string, string> = {
  INVITED: 'bg-hivis-500/10 text-ink-muted',
  ACTIVE: 'bg-safe-50 text-safe-700',
  SUSPENDED: 'bg-danger-50 text-danger-700',
  REMOVED: 'bg-surface-sunken text-ink-muted',
};

export function WorkerAccessManager({
  siteId,
  enforced,
  rows,
  canManage,
  canSetEnforcement,
  otherSites = [],
  requirements = [],
}: {
  siteId: string;
  enforced: boolean;
  rows: AssignmentRow[];
  canManage: boolean;
  canSetEnforcement: boolean;
  /** SC-023 Phase 2 — projects this manager can transfer a worker to. */
  otherSites?: { id: string; name: string }[];
  /** SC-023 Phase 3 — competency requirements for this site. */
  requirements?: {
    requirement: string;
    label: string;
    description: string;
    blocksFirstTime: boolean;
    enabled: boolean;
    blockedCount: number;
    blockedNames: string[];
  }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ fullName: '', company: '', mobile: '' });
  const [lastCode, setLastCode] = useState<{
    name: string;
    code: string;
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [detail, setDetail] = useState({
    role: '',
    startDate: '',
    endDate: '',
  });
  const [transferTo, setTransferTo] = useState<Record<string, string>>({});
  const [pendingReq, setPendingReq] = useState<{
    requirement: string;
    label: string;
    count: number;
    names: string[];
  } | null>(null);

  /**
   * Requirements are two-step by design: the first call returns who would be
   * blocked and writes nothing, and only an explicit confirmation applies it.
   * The server enforces this too, so the preview cannot be skipped.
   */
  async function toggleRequirement(
    requirement: string,
    label: string,
    enabled: boolean,
    confirm = false,
  ) {
    setBusy(requirement);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/worker-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'setRequirement',
          requirement,
          enabled,
          confirm,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.previewRequired) {
        setPendingReq({
          requirement,
          label,
          count: data.preview?.count ?? 0,
          names: data.preview?.names ?? [],
        });
        return;
      }
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not update the requirement.');
        return;
      }
      setPendingReq(null);
      setNotice(
        enabled
          ? `${label} is now required. ${data.blockedAtEnable ?? 0} worker(s) did not meet it.`
          : `${label} is no longer required.`,
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function openDetails(r: AssignmentRow) {
    setEditing(editing === r.id ? null : r.id);
    setDetail({
      role: r.role ?? '',
      startDate: r.startDate ? toInput(r.startDate) : '',
      endDate: r.endDate ? toInput(r.endDate) : '',
    });
  }

  async function call(body: Record<string, unknown>, key: string, ok: string) {
    setBusy(key);
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
        return null;
      }
      setNotice(ok);
      router.refresh();
      return data as { invitationCode?: string; smsDelivered?: boolean };
    } finally {
      setBusy(null);
    }
  }

  async function invite() {
    if (!form.fullName.trim() || !form.company.trim() || !form.mobile.trim())
      return;
    const data = await call(
      { action: 'invite', ...form },
      'invite',
      `Invited ${form.fullName.trim()}.`,
    );
    if (data?.invitationCode) {
      setLastCode({ name: form.fullName.trim(), code: data.invitationCode });
      setForm({ fullName: '', company: '', mobile: '' });
      setShowInvite(false);
    }
  }

  const active = rows.filter((r) => r.status === 'ACTIVE').length;
  const waiting = rows.filter((r) => r.status === 'INVITED').length;
  const expiring = rows.filter((r) => r.expiringSoon);

  return (
    <div className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}

      {/* The invitation code is shown prominently after inviting. It is the
          fallback when SMS does not arrive — which is ALWAYS, while the mock
          provider is active — so it must not be buried. */}
      {lastCode ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
          <p className="text-sm font-semibold text-brand-700">
            Invitation code for {lastCode.name}:{' '}
            <span className="font-mono text-base">{lastCode.code}</span>
          </p>
          <p className="mt-0.5 text-xs text-brand-700">
            Read this to the worker if they do not receive the text message.
            They still need approving below before they can check in.
          </p>
        </div>
      ) : null}

      <div
        className={`rounded-xl border px-4 py-3 ${
          enforced
            ? 'border-safe-500/40 bg-safe-50'
            : 'border-line bg-surface-sunken'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink">
              {enforced
                ? 'Controlled access is ON for this site'
                : 'Controlled access is OFF for this site'}
            </p>
            <p className="text-xs text-ink-muted">
              {enforced
                ? 'Only approved workers can check in. Anyone else is turned away and told why.'
                : 'Any worker can check in, as before. Invitations below are recorded but not enforced.'}
            </p>
          </div>
          {canSetEnforcement ? (
            <button
              type="button"
              disabled={busy === 'enforce'}
              onClick={() =>
                call(
                  { action: 'setEnforcement', enabled: !enforced },
                  'enforce',
                  enforced
                    ? 'Controlled access switched off.'
                    : 'Controlled access switched on.',
                )
              }
              className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              {enforced ? 'Switch off' : 'Switch on'}
            </button>
          ) : (
            <span className="shrink-0 text-xs text-ink-subtle">
              Only a Director can change this.
            </span>
          )}
        </div>
      </div>

      {/* SC-023 Phase 2 — surfaced BEFORE it bites at the gate. A manager
          should learn about an expiry from this page, not from a worker being
          turned away on Monday morning. */}
      {expiring.length > 0 ? (
        <div className="rounded-xl border border-hivis-500/40 bg-hivis-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            {expiring.length} worker{expiring.length === 1 ? '' : 's'} lose
            access within {7} days
          </p>
          <p className="text-xs text-ink-muted">
            {expiring
              .map(
                (r) =>
                  `${r.workerName} (${r.daysUntilExpiry} day${r.daysUntilExpiry === 1 ? '' : 's'})`,
              )
              .join(', ')}
          </p>
        </div>
      ) : null}

      {requirements.length > 0 && canManage ? (
        <div className="rounded-xl border border-line bg-surface p-4">
          <h4 className="text-sm font-bold text-ink">
            Requirements before a worker can check in
          </h4>
          <p className="mb-3 text-xs text-ink-muted">
            All off by default. These only apply where controlled access is
            switched on, and a worker is told exactly which ones they fail.
          </p>

          {pendingReq ? (
            <div className="mb-3 rounded-lg border border-hivis-500/40 bg-hivis-500/10 px-3 py-2.5">
              <p className="text-sm font-semibold text-ink">
                Turning on “{pendingReq.label}” will block {pendingReq.count}{' '}
                worker{pendingReq.count === 1 ? '' : 's'} on this site
              </p>
              {pendingReq.names.length > 0 ? (
                <p className="mt-0.5 text-xs text-ink-muted">
                  {pendingReq.names.join(', ')}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-ink-muted">
                  No currently approved worker would be affected.
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy === pendingReq.requirement}
                  onClick={() =>
                    toggleRequirement(
                      pendingReq.requirement,
                      pendingReq.label,
                      true,
                      true,
                    )
                  }
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Turn it on anyway
                </button>
                <button
                  type="button"
                  onClick={() => setPendingReq(null)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <ul className="divide-y divide-line rounded-lg border border-line">
            {requirements.map((q) => (
              <li
                key={q.requirement}
                className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {q.label}
                    {q.enabled ? (
                      <span className="ml-2 rounded bg-safe-50 px-1.5 py-0.5 text-xs font-medium text-safe-700">
                        Required
                      </span>
                    ) : null}
                    {!q.blocksFirstTime ? (
                      <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                        Never blocks a first induction
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-ink-muted">{q.description}</p>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {q.blockedCount === 0
                      ? 'All approved workers meet this.'
                      : `${q.blockedCount} approved worker${q.blockedCount === 1 ? '' : 's'} would not meet this: ${q.blockedNames.join(', ')}`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === q.requirement}
                  onClick={() =>
                    toggleRequirement(q.requirement, q.label, !q.enabled)
                  }
                  className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                >
                  {q.enabled ? 'Stop requiring' : 'Require'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {rows.length} assignment{rows.length === 1 ? '' : 's'} · {active}{' '}
          approved
          {waiting > 0 ? ` · ${waiting} awaiting approval` : ''}
        </p>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/platform/sites/${siteId}/worker-access/export`}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              Export CSV
            </a>
            <button
              type="button"
              onClick={() => setShowInvite((v) => !v)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              {showInvite ? 'Cancel' : 'Invite a worker'}
            </button>
          </div>
        ) : null}
      </div>

      {showInvite ? (
        <div className="rounded-xl border border-line bg-surface-sunken p-4">
          <div className="flex flex-wrap gap-2">
            <input
              value={form.fullName}
              onChange={(e) =>
                setForm((f) => ({ ...f, fullName: e.target.value }))
              }
              placeholder="Full name"
              className="min-w-40 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <input
              value={form.company}
              onChange={(e) =>
                setForm((f) => ({ ...f, company: e.target.value }))
              }
              placeholder="Company"
              className="min-w-40 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <input
              value={form.mobile}
              onChange={(e) =>
                setForm((f) => ({ ...f, mobile: e.target.value }))
              }
              placeholder="07700 900123"
              className="min-w-40 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <button
              type="button"
              disabled={busy === 'invite'}
              onClick={invite}
              className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Send invitation
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            They receive a text with an invitation code. You will also see the
            code here to read out if the message does not arrive.
          </p>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-5 py-10 text-center text-sm text-ink-subtle">
          No workers assigned to this project yet.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {r.workerName}
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.backfilled ? (
                    <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                      Existing worker
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-ink-muted">
                  {r.company} · {r.mobile}
                </p>
                {r.role ||
                r.startDate ||
                r.endDate ||
                r.transferredFromSiteName ? (
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {r.role ? (ROLE_LABEL[r.role] ?? r.role) : 'Role not set'}
                    {r.startDate || r.endDate
                      ? ` · ${r.startDate ? formatDateTimeUK(r.startDate).slice(0, 10) : 'any date'} to ${r.endDate ? formatDateTimeUK(r.endDate).slice(0, 10) : 'no end'}`
                      : ''}
                    {WINDOW_NOTE[r.windowState]
                      ? ` · ${WINDOW_NOTE[r.windowState]}`
                      : ''}
                    {r.transferredFromSiteName
                      ? ` · transferred from ${r.transferredFromSiteName}`
                      : ''}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-ink-subtle">
                  Invited {formatDateTimeUK(r.invitedAt)}
                  {r.invitedByName ? ` by ${r.invitedByName}` : ''}
                  {r.approvedAt
                    ? ` · approved ${formatDateTimeUK(r.approvedAt)}${r.approvedByName ? ` by ${r.approvedByName}` : ''}`
                    : ''}
                </p>
                {r.status === 'INVITED' && r.invitationCode ? (
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Invitation code:{' '}
                    <span className="font-mono">{r.invitationCode}</span>
                  </p>
                ) : null}
              </div>

              {canManage ? (
                <div className="flex shrink-0 flex-wrap gap-2">
                  {r.status !== 'ACTIVE' ? (
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() =>
                        call(
                          {
                            action:
                              r.status === 'SUSPENDED'
                                ? 'reinstate'
                                : 'approve',
                            assignmentId: r.id,
                          },
                          r.id,
                          `${r.workerName} can now check in.`,
                        )
                      }
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                    >
                      {r.status === 'SUSPENDED' ? 'Reinstate' : 'Approve'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() =>
                        call(
                          { action: 'suspend', assignmentId: r.id },
                          r.id,
                          `${r.workerName}'s access is suspended.`,
                        )
                      }
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                    >
                      Suspend
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openDetails(r)}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                  >
                    {editing === r.id ? 'Close' : 'Role & dates'}
                  </button>
                  {r.status !== 'REMOVED' ? (
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Remove ${r.workerName} from this project?\n\nTheir check-ins, inductions and permits here are kept.`,
                          )
                        ) {
                          return;
                        }
                        call(
                          { action: 'remove', assignmentId: r.id },
                          r.id,
                          `${r.workerName} removed from this project.`,
                        );
                      }}
                      className="rounded-lg border border-danger-500/40 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : null}

              {editing === r.id && canManage ? (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-ink-muted">
                      Role
                      <select
                        value={detail.role}
                        onChange={(e) =>
                          setDetail((d) => ({ ...d, role: e.target.value }))
                        }
                        className="mt-0.5 block rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      >
                        <option value="">Not set</option>
                        {Object.entries(ROLE_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-ink-muted">
                      Access from
                      <input
                        type="date"
                        value={detail.startDate}
                        onChange={(e) =>
                          setDetail((d) => ({
                            ...d,
                            startDate: e.target.value,
                          }))
                        }
                        className="mt-0.5 block rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      />
                    </label>
                    <label className="text-xs text-ink-muted">
                      Access to (inclusive)
                      <input
                        type="date"
                        value={detail.endDate}
                        onChange={(e) =>
                          setDetail((d) => ({ ...d, endDate: e.target.value }))
                        }
                        className="mt-0.5 block rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() =>
                        call(
                          {
                            action: 'setDetails',
                            assignmentId: r.id,
                            ...detail,
                          },
                          r.id,
                          `Updated ${r.workerName}.`,
                        )
                      }
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-subtle">
                    The role is recorded for reporting only — it does not change
                    what this worker can see or do. Access runs to the END of
                    the “access to” day.
                  </p>

                  {otherSites.length > 0 && r.status !== 'REMOVED' ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                      <select
                        aria-label={`Transfer ${r.workerName} to`}
                        value={transferTo[r.id] ?? ''}
                        onChange={(e) =>
                          setTransferTo((t) => ({
                            ...t,
                            [r.id]: e.target.value,
                          }))
                        }
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      >
                        <option value="">Transfer to…</option>
                        {otherSites.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy === r.id || !transferTo[r.id]}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Transfer ${r.workerName} to the selected project?\n\nThey will need approving there before they can check in, and are removed from this project. Their history here is kept.`,
                            )
                          ) {
                            return;
                          }
                          call(
                            {
                              action: 'transfer',
                              assignmentId: r.id,
                              toSiteId: transferTo[r.id],
                            },
                            r.id,
                            `${r.workerName} transferred — they need approving on the destination project.`,
                          );
                        }}
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                      >
                        Transfer
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-subtle">
        Removing or suspending someone never deletes their history. A worker
        already checked in can always check out, so the site record of who is on
        the premises stays correct.
      </p>
    </div>
  );
}
