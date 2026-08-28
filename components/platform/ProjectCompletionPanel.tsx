'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ChecklistItem {
  key: string;
  label: string;
  severity: 'BLOCK' | 'WARN' | 'UNAVAILABLE';
  count: number | null;
  satisfied: boolean;
  detail: string;
  unavailableReason?: string;
  resolveHref?: string;
  resolveLabel?: string;
}

interface Checklist {
  items: ChecklistItem[];
  blockers: ChecklistItem[];
  warnings: ChecklistItem[];
  canClose: boolean;
}

/**
 * SC-025 — the completion checklist and the close/reopen controls.
 *
 * The checklist is shown BEFORE the button does anything, and blockers are
 * explained rather than discovered on submit — the SC-014 lesson about a
 * disabled Save with no stated reason. Warnings are listed with an explicit
 * acknowledgement, because closing over them is a decision someone is making,
 * and it is recorded against their name.
 */
export function ProjectCompletionPanel({
  siteId,
  status,
  completedAt,
  completedByName,
  canClose,
  canReopen,
}: {
  siteId: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'COMPLETED';
  completedAt: string | null;
  completedByName: string | null;
  canClose: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCompleted = status === 'COMPLETED';
  const url = `/api/platform/sites/${siteId}/completion`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setChecklist(data.checklist as Checklist);
    } catch {
      /* the panel still offers the action; the server re-checks anyway */
    }
  }, [url]);

  useEffect(() => {
    if (open && !isCompleted && checklist === null) void load();
  }, [open, isCompleted, checklist, load]);

  async function close() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not complete the project.');
        if (data.checklist) setChecklist(data.checklist as Checklist);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, restoreAssignments: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not reopen the project.');
        return;
      }
      setReason('');
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (isCompleted) {
    return (
      <section className="rounded-2xl border border-brand-700/30 bg-brand-700/5 p-5">
        <h2 className="text-base font-bold text-ink">Project completed</h2>
        <p className="mt-1 text-sm text-ink-muted">
          This project&rsquo;s records are read-only and preserved for audit.
          Worker access is suspended and scheduled work has stopped.
          {completedByName
            ? ` Completed by ${completedByName}${
                completedAt
                  ? ` on ${new Date(completedAt).toLocaleDateString('en-GB')}`
                  : ''
              }.`
            : ''}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          A close-out pack can still be generated, and all history remains
          available.
        </p>

        {canReopen ? (
          <div className="mt-3">
            {open ? (
              <div className="rounded-lg border border-line bg-surface p-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold text-ink">
                    Why are you reopening this project?
                  </span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Client raised a defect requiring records to be updated"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
                  />
                </label>
                <p className="mt-1 text-xs text-ink-subtle">
                  Recorded against your name. Worker access suspended by the
                  completion will be restored.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={reopen}
                    disabled={busy || reason.trim() === ''}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
                  >
                    {busy ? 'Reopening…' : 'Reopen project'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-2 text-sm font-semibold text-ink-subtle"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink"
              >
                Reopen project…
              </button>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-subtle">
            Only a Director can reopen a completed project.
          </p>
        )}

        {error ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}
      </section>
    );
  }

  if (!canClose) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-ink">
            Complete this project
          </h2>
          <p className="text-sm text-ink-muted">
            Closes the project for good order: records become read-only, worker
            access is suspended, scheduled work stops and automated
            notifications end. Nothing is deleted, and a Director can reopen it
            if needed.
          </p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink"
          >
            Check readiness…
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-4">
          {checklist === null ? (
            <p className="text-sm text-ink-subtle">Checking…</p>
          ) : (
            <>
              <ul className="divide-y divide-line border-y border-line">
                {checklist.items.map((i) => (
                  <li key={i.key} className="flex items-start gap-3 py-2">
                    <span className="mt-0.5 w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide">
                      {i.severity === 'UNAVAILABLE' ? (
                        <span className="text-ink-subtle">n/a</span>
                      ) : i.satisfied ? (
                        <span className="text-safe-700">clear</span>
                      ) : i.severity === 'BLOCK' ? (
                        <span className="text-danger-600">must fix</span>
                      ) : (
                        <span className="text-hivis-600">warning</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">
                        {i.label}
                        {i.count !== null && !i.satisfied
                          ? ` — ${i.count}`
                          : ''}
                      </span>
                      {!i.satisfied ? (
                        <span className="block text-xs text-ink-muted">
                          {i.unavailableReason ?? i.detail}
                        </span>
                      ) : null}
                      {/* BL-001 — a route from the blocker to the place it can
                          be resolved. The action itself stays out of this list. */}
                      {!i.satisfied && i.resolveHref ? (
                        <a
                          href={i.resolveHref}
                          className="mt-1 inline-block text-sm font-semibold text-brand-700 hover:underline"
                        >
                          {i.resolveLabel ?? 'Review'} →
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>

              {checklist.blockers.length > 0 ? (
                <p className="mt-3 rounded border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600">
                  This project cannot be completed until the items marked
                  &ldquo;must fix&rdquo; are resolved.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {checklist.warnings.length > 0 ? (
                    <label className="flex items-start gap-2 rounded border border-hivis-500/40 bg-hivis-500/10 px-3 py-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                        className="mt-1"
                      />
                      <span>
                        I understand {checklist.warnings.length} item
                        {checklist.warnings.length === 1 ? ' is' : 's are'}{' '}
                        still outstanding. These will be recorded against the
                        completion and will become read-only.
                      </span>
                    </label>
                  ) : null}

                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-semibold text-ink">
                      Note (optional)
                    </span>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Practical completion reached 27 June"
                      className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={close}
                    disabled={busy || (checklist.warnings.length > 0 && !ack)}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
                  >
                    {busy ? 'Completing…' : 'Complete project'}
                  </button>
                  {checklist.warnings.length > 0 && !ack ? (
                    <p className="text-xs text-ink-subtle">
                      Tick the acknowledgement above to continue.
                    </p>
                  ) : null}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setChecklist(null);
                  setAck(false);
                }}
                className="mt-3 text-sm font-semibold text-ink-subtle"
              >
                Cancel
              </button>
            </>
          )}
          {error ? (
            <p className="mt-2 text-sm text-danger-600">{error}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
