import { formatDateTimeUK } from '@/lib/datetime';
import type { SmsLogRow } from '@/services/sms/smsSendService';

/**
 * Outbound SMS audit trail and 30-day usage (Admin → Settings → Integrations).
 *
 * Shows WHAT was sent, to a masked number, and whether it worked — never the
 * message body. Bodies carry one-time sign-in codes and invitation codes, so
 * displaying them would hand an admin screen a list of live credentials.
 *
 * The 30-day counts sit above the log because SMS is billed per message: the
 * question an administrator needs answered before enabling live delivery is
 * "how many will this send?", and that should not require reading a table.
 */

const PURPOSE_LABEL: Record<string, string> = {
  OTP: 'Sign-in code',
  WORKER_INVITE: 'Worker invitation',
  TEST: 'Connectivity test',
  OTHER: 'Other',
};

export function SmsActivityLog({
  rows,
  usage,
}: {
  rows: SmsLogRow[];
  usage: {
    last30Days: number;
    failed30Days: number;
    byPurpose: { purpose: string; count: number }[];
  };
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-base font-bold text-ink">SMS activity</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Every outbound message is recorded. Message content is deliberately not
        stored — it contains one-time codes.
      </p>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="rounded-lg border border-line bg-surface-sunken px-4 py-2">
          <p className="text-lg font-bold text-ink">{usage.last30Days}</p>
          <p className="text-xs text-ink-muted">Sent, last 30 days</p>
        </div>
        <div className="rounded-lg border border-line bg-surface-sunken px-4 py-2">
          <p
            className={`text-lg font-bold ${usage.failed30Days > 0 ? 'text-danger-600' : 'text-ink'}`}
          >
            {usage.failed30Days}
          </p>
          <p className="text-xs text-ink-muted">Failed, last 30 days</p>
        </div>
        {usage.byPurpose.map((p) => (
          <div
            key={p.purpose}
            className="rounded-lg border border-line bg-surface-sunken px-4 py-2"
          >
            <p className="text-lg font-bold text-ink">{p.count}</p>
            <p className="text-xs text-ink-muted">
              {PURPOSE_LABEL[p.purpose] ?? p.purpose}
            </p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-sunken px-5 py-8 text-center text-sm text-ink-subtle">
          No messages sent yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-subtle">
              <tr>
                <th className="pb-2 pr-4 font-medium">When</th>
                <th className="pb-2 pr-4 font-medium">Purpose</th>
                <th className="pb-2 pr-4 font-medium">To</th>
                <th className="pb-2 pr-4 font-medium">Provider</th>
                <th className="pb-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 text-ink-muted">
                    {formatDateTimeUK(r.createdAt)}
                  </td>
                  <td className="py-2 pr-4 text-ink">
                    {PURPOSE_LABEL[r.purpose] ?? r.purpose}
                    {r.actorName ? (
                      <span className="block text-xs text-ink-subtle">
                        by {r.actorName}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink-muted">
                    {r.toMasked}
                  </td>
                  <td className="py-2 pr-4 text-ink-muted">{r.provider}</td>
                  <td className="py-2">
                    {r.ok ? (
                      <span className="rounded bg-safe-50 px-1.5 py-0.5 text-xs font-medium text-safe-700">
                        Sent
                      </span>
                    ) : (
                      <>
                        <span className="rounded bg-danger-50 px-1.5 py-0.5 text-xs font-medium text-danger-700">
                          Failed
                        </span>
                        {r.error ? (
                          <span className="block text-xs text-ink-muted">
                            {r.error}
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
