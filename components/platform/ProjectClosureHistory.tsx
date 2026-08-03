/**
 * SC-025 — the closure/reopen audit trail for a project.
 *
 * The requirement asks to see who closed a project and when, and the reason a
 * project was reopened. Both live here, newest first, alongside the warnings
 * that were overridden at the time — "completed with 4 open actions" is not
 * recoverable later if those actions were closed afterwards, which is exactly
 * why the count is snapshotted rather than recomputed.
 */
export function ProjectClosureHistory({
  events,
}: {
  events: {
    id: string;
    action: string;
    reason: string | null;
    warnings: { key: string; label: string; count: number }[];
    actorName: string;
    createdAt: string;
  }[];
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-base font-bold text-ink">Completion history</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Every completion and reopening is kept permanently.
      </p>
      <ul className="divide-y divide-line">
        {events.map((e) => (
          <li key={e.id} className="py-2">
            <p className="text-sm font-semibold text-ink">
              {e.action === 'CLOSED' ? 'Project completed' : 'Project reopened'}{' '}
              <span className="font-normal text-ink-subtle">
                by {e.actorName} ·{' '}
                {new Date(e.createdAt).toLocaleString('en-GB')}
              </span>
            </p>
            {e.reason ? (
              <p className="text-sm text-ink-muted">{e.reason}</p>
            ) : null}
            {e.warnings.length > 0 ? (
              <p className="mt-1 text-xs text-ink-subtle">
                Outstanding at the time:{' '}
                {e.warnings.map((w) => `${w.label} (${w.count})`).join(', ')}.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
