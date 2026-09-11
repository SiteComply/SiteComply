'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * PROJECT ACCESS SETTINGS — site-level, not a list of people.
 *
 * This was "Manage project access" and carried a second worker list with an
 * Approve button on every row. The roster above is where workers are viewed and,
 * by selecting one, managed. What belongs here is only what applies to the
 * PROJECT: whether access is enforced at all, and what a worker must satisfy.
 *
 * The enforcement switch sits at the TOP with its current state spelled out,
 * because everything below means something different depending on it: with
 * enforcement off these are records, with it on they are the gate.
 */

export function WorkerAccessManager({
  siteId,
  canManage,
  otherSites = [],
  requirements = [],
}: {
  siteId: string;
  canManage: boolean;
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
  // Seeded from the page: the Workers-tab toolbar button links to ?invite=1,
  // which opens the disclosure and this form together. One invite path.


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
      return data as { smsDelivered?: boolean; autoApproved?: boolean };
    } finally {
      setBusy(null);
    }
  }



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

      {/*
        THE CONTROLLED ACCESS SWITCH WAS HERE.

        It decided whether an assignment was a record or a gate, and it was OFF
        on every site in production — so it protected nothing it was meant to
        protect, while making the rule impossible to state simply. A worker is
        invited and assigned to a project before they work there; that is now
        the behaviour, with no configuration to get wrong.
      */}

      {requirements.length > 0 && canManage ? (
        <div className="rounded-xl border border-line bg-surface p-4">
          <h4 className="text-sm font-bold text-ink">
            Requirements before an operative can check in
          </h4>
          <p className="mb-3 text-xs text-ink-muted">
            All off by default. Every worker must be invited to this project
            before they can check in; these add further conditions on top, and a
            worker is told exactly which ones they fail.
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
                  No operative on this project would be affected.
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
                      ? 'All operatives on this project meet this.'
                      : `${q.blockedCount} worker${q.blockedCount === 1 ? '' : 's'} on this project would not meet this: ${q.blockedNames.join(', ')}`}
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

      {/*
        THE WORKER LIST USED TO BE HERE.
        It showed the same people as "Workers on this project" above, in a second
        vocabulary, with an Approve button beside every ordinary worker for a step
        that no longer exists. Workers are viewed in the roster and managed by
        selecting them there — see WorkerAssignmentActions. What is left is what
        this panel should always have been: settings for the PROJECT, not a list
        of people.
      */}

    </div>
  );
}
