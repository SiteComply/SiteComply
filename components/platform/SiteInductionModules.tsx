'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SiteModuleRow {
  moduleId: string;
  slug: string;
  title: string;
  mandatory: boolean;
  issuedVersion: number | null;
  companyHeading: string;
  companyNarration: string;
  state: 'INCLUDED' | 'EXCLUDED' | 'OVERRIDDEN' | null;
  included: boolean;
  overrideNarration: string | null;
  reason: string | null;
  decidedByName: string | null;
  displacedBySiteContent: boolean;
}

/**
 * What this project says about the company's standard induction content.
 *
 * ── THE DEFAULT IS INVISIBLE WORK ─────────────────────────────────────────
 *
 * Most projects will never touch this screen: the company decides what every
 * operative hears and it applies. So the panel reads as a LIST OF WHAT WILL BE
 * SAID, with the departures marked — not as a form of switches waiting to be
 * set.
 *
 * ── A DEPARTURE IS NEVER QUIET ────────────────────────────────────────────
 *
 * Leaving a module out, or replacing its words, is this project saying
 * something other than the company standard. Both demand a reason, both record
 * who decided, and both are shown in amber wherever the module appears —
 * including in the script a reviewer approves. A departure nobody can see is
 * indistinguishable from a mistake six months later.
 */
export function SiteInductionModules({
  siteId,
  modules,
  canOverride,
}: {
  siteId: string;
  modules: SiteModuleRow[];
  /** Directors only, by the owner's decision. */
  canOverride: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [mode, setMode] = useState<'EXCLUDED' | 'OVERRIDDEN'>('EXCLUDED');
  const [reason, setReason] = useState('');
  const [wording, setWording] = useState('');

  if (modules.length === 0) {
    return (
      <section className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">Company induction content</h2>
        <p className="mt-2 text-sm text-ink-muted">
          No company induction modules have been issued yet, so this project’s
          induction is built entirely from its own records. A Director can write
          and issue them in Settings → Induction modules.
        </p>
      </section>
    );
  }

  async function decide(moduleId: string, body: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/induction-modules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ moduleId, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return;
      }
      setEditing(null);
      setReason('');
      setWording('');
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="text-sm font-bold text-ink">Company induction content</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        Standard content issued centrally and included in every project’s
        induction, alongside this site’s own hazards and arrangements. It is
        spoken after the site-specific safety scenes and before the site rules,
        PPE and the close.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      <ul className="mt-3 divide-y divide-line">
        {modules.map((m) => {
          const departed = m.state === 'EXCLUDED' || m.state === 'OVERRIDDEN';
          return (
            <li key={m.moduleId} className="py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">{m.title}</span>

                {m.issuedVersion === null ? (
                  <span className="text-xs text-ink-subtle">
                    Not issued yet — not in any induction
                  </span>
                ) : m.displacedBySiteContent ? (
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-subtle">
                    Covered by this project’s own arrangement
                  </span>
                ) : m.state === 'EXCLUDED' ? (
                  <span className="rounded-full bg-hivis-400/20 px-2 py-0.5 text-xs font-semibold text-hivis-600">
                    Left out of this project
                  </span>
                ) : m.state === 'OVERRIDDEN' ? (
                  <span className="rounded-full bg-hivis-400/20 px-2 py-0.5 text-xs font-semibold text-hivis-600">
                    Changed for this project
                  </span>
                ) : (
                  <span className="rounded-full bg-safe-50 px-2 py-0.5 text-xs font-semibold text-safe-700">
                    Included
                  </span>
                )}

                {m.mandatory && (
                  <span className="text-xs text-ink-subtle">Required on every project</span>
                )}

                {m.issuedVersion !== null && (
                  <span className="ml-auto text-xs text-ink-subtle">
                    Company revision {m.issuedVersion}
                  </span>
                )}
              </div>

              <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">
                {m.state === 'OVERRIDDEN' && m.overrideNarration
                  ? m.overrideNarration
                  : m.companyNarration}
              </p>

              {departed && (
                <p className="mt-1 text-xs text-hivis-600">
                  {m.state === 'EXCLUDED' ? 'Left out' : 'Changed'}
                  {m.decidedByName ? ` by ${m.decidedByName}` : ''}
                  {m.reason ? ` — ${m.reason}` : ''}
                </p>
              )}

              {m.displacedBySiteContent && (
                <p className="mt-1 text-xs text-ink-subtle">
                  This project records its own arrangement for the same subject,
                  so its words are used and this module is left out
                  automatically — an operative is never told the same thing
                  twice.
                </p>
              )}

              {m.issuedVersion !== null && !m.displacedBySiteContent && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {departed ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => decide(m.moduleId, { state: 'DEFAULT' }, `d-${m.moduleId}`)}
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                    >
                      {busy === `d-${m.moduleId}` ? 'Saving…' : 'Back to the company standard'}
                    </button>
                  ) : (
                    <>
                      {!m.mandatory && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(editing === m.moduleId ? null : m.moduleId);
                            setMode('EXCLUDED');
                          }}
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                        >
                          Leave it out of this project
                        </button>
                      )}
                      {canOverride && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(editing === m.moduleId ? null : m.moduleId);
                            setMode('OVERRIDDEN');
                            setWording(m.companyNarration);
                          }}
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                        >
                          Change the wording here
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {editing === m.moduleId && (
                <div className="mt-2 rounded-lg border border-line bg-surface-sunken p-3">
                  {mode === 'OVERRIDDEN' && (
                    <>
                      <label className="block text-xs font-semibold text-ink" htmlFor={`w-${m.moduleId}`}>
                        What this project says instead
                      </label>
                      <textarea
                        id={`w-${m.moduleId}`}
                        rows={5}
                        value={wording}
                        onChange={(e) => setWording(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                      />
                    </>
                  )}
                  <label className="mt-2 block text-xs font-semibold text-ink" htmlFor={`r-${m.moduleId}`}>
                    Why does this project differ? Kept on the record.
                  </label>
                  <input
                    id={`r-${m.moduleId}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        reason.trim().length < 10 ||
                        (mode === 'OVERRIDDEN' && wording.trim().length < 40) ||
                        busy !== null
                      }
                      onClick={() =>
                        decide(
                          m.moduleId,
                          mode === 'OVERRIDDEN'
                            ? { state: 'OVERRIDDEN', reason, overrideNarration: wording }
                            : { state: 'EXCLUDED', reason },
                          `s-${m.moduleId}`,
                        )
                      }
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {busy === `s-${m.moduleId}`
                        ? 'Saving…'
                        : mode === 'OVERRIDDEN'
                          ? 'Use this project’s wording'
                          : 'Leave it out'}
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
                    Existing videos are not changed. They will show as out of
                    date, and a new version picks this up when you generate one.
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
