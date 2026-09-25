'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SiteLibraryRow {
  assetId: string;
  title: string;
  description: string | null;
  placement: string;
  mandatory: boolean;
  issuedVersion: number | null;
  durationLabel: string | null;
  included: boolean | null;
  effectivelyIncluded: boolean;
  reason: string | null;
  decidedByName: string | null;
  decidedByRealm: string | null;
  replacesModuleTitle: string | null;
}

/**
 * Which company videos this project's induction carries.
 *
 * Reads as a LIST OF WHAT WILL BE SHOWN with the departures marked, for the same
 * reason the company modules panel does: on almost every project the company
 * decides and it applies, so this is not a form of switches waiting to be set.
 *
 * ── THERE IS NO OVERRIDE HERE, AND THAT IS THE POINT ──────────────────────
 *
 * A module's words can be rewritten for one site. A film cannot be re-shot for one
 * site, so the only decision available is whether it plays — which makes the
 * reason on an exclusion the whole record of the departure.
 */
export function SiteLibraryPanel({
  siteId,
  assets,
  endpoint,
}: {
  siteId: string;
  assets: SiteLibraryRow[];
  endpoint: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  if (assets.length === 0) return null;

  async function decide(assetId: string, body: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return;
      }
      setEditing(null);
      setReason('');
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="text-sm font-bold text-ink">Company videos</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        Approved footage issued centrally and played in every project’s induction
        alongside the scenes generated from this site’s own records.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      <ul className="mt-3 divide-y divide-line">
        {assets.map((a) => {
          const left = a.included === false;
          return (
            <li key={a.assetId} className="py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">{a.title}</span>
                {a.issuedVersion === null ? (
                  <span className="text-xs text-ink-subtle">
                    Not issued yet — not in any induction
                  </span>
                ) : left ? (
                  <span className="rounded-full bg-hivis-400/20 px-2 py-0.5 text-xs font-semibold text-hivis-600">
                    Left out of this project
                  </span>
                ) : (
                  <span className="rounded-full bg-safe-50 px-2 py-0.5 text-xs font-semibold text-safe-700">
                    Included
                  </span>
                )}
                {a.mandatory && (
                  <span className="text-xs text-ink-subtle">Required on every project</span>
                )}
                <span className="ml-auto text-xs text-ink-subtle">
                  {a.durationLabel ? `${a.durationLabel} · ` : ''}
                  {a.issuedVersion !== null ? `revision ${a.issuedVersion}` : ''}
                </span>
              </div>

              {a.description && (
                <p className="mt-1 text-sm text-ink-muted">{a.description}</p>
              )}

              {a.replacesModuleTitle && a.effectivelyIncluded && (
                <p className="mt-1 text-xs text-ink-subtle">
                  Shown instead of the written “{a.replacesModuleTitle}” module — an
                  operative is not told the same thing twice.
                </p>
              )}

              {left && (
                <p className="mt-1 text-xs text-hivis-600">
                  Left out
                  {a.decidedByName ? ` by ${a.decidedByName}` : ''}
                  {a.decidedByRealm ? ` (${a.decidedByRealm})` : ''}
                  {a.reason ? ` — ${a.reason}` : ''}
                </p>
              )}

              {a.issuedVersion !== null && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {left ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => decide(a.assetId, { state: 'DEFAULT' }, `d-${a.assetId}`)}
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                    >
                      {busy === `d-${a.assetId}` ? 'Saving…' : 'Back to the company standard'}
                    </button>
                  ) : (
                    !a.mandatory && (
                      <button
                        type="button"
                        onClick={() => setEditing(editing === a.assetId ? null : a.assetId)}
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                      >
                        Leave it out of this project
                      </button>
                    )
                  )}
                </div>
              )}

              {editing === a.assetId && (
                <div className="mt-2 rounded-lg border border-line bg-surface-sunken p-3">
                  <label className="block text-xs font-semibold text-ink" htmlFor={`r-${a.assetId}`}>
                    Why does this project leave it out? Kept on the record.
                  </label>
                  <input
                    id={`r-${a.assetId}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={reason.trim().length < 10 || busy !== null}
                      onClick={() =>
                        decide(a.assetId, { state: 'EXCLUDED', reason }, `s-${a.assetId}`)
                      }
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {busy === `s-${a.assetId}` ? 'Saving…' : 'Leave it out'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-ink-subtle">
                    Existing videos are not changed. They will show as out of date,
                    and a new version picks this up when you generate one.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
