'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ModuleRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  mandatory: boolean;
  defaultIncluded: boolean;
  active: boolean;
  replacesSceneType: string | null;
  issued: { version: number; issuedOn: string; issuedByName: string | null } | null;
  draft: { id: string; version: number; preparedByName: string } | null;
  /** The words in force, or the draft's words when nothing is issued yet. */
  heading: string;
  narration: string;
  revisionCount: number;
}

/**
 * Company induction modules — the content every induction carries.
 *
 * ── THE STATE THAT MATTERS IS "IS IT ISSUED" ──────────────────────────────
 *
 * A module with no issued revision reaches nobody, however carefully it is
 * written. That is the safety property of the whole design, so it is the first
 * thing each row says - not a quiet badge somewhere on a detail page.
 *
 * ── EDITING IS DRAFTING ───────────────────────────────────────────────────
 *
 * There is no "save" that changes what operatives hear. Editing creates or
 * updates a draft; issuing is a separate, deliberate act with a note saying
 * what changed, and it is a Director's alone.
 */
export function InductionModulesSection({
  modules,
  canDraft,
  canIssue,
}: {
  modules: ModuleRow[];
  canDraft: boolean;
  canIssue: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ heading: string; narration: string }>({
    heading: '',
    narration: '',
  });
  const [issuing, setIssuing] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function call(body: Record<string, unknown>, key: string) {
    if (busy) return null;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/platform/settings/induction-modules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return null;
      }
      router.refresh();
      return data as Record<string, unknown>;
    } catch {
      setError('Network problem. Please try again.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function edit(m: ModuleRow) {
    const started = await call({ action: 'startDraft', moduleId: m.id }, `draft-${m.id}`);
    if (!started) return;
    setDraft({ heading: m.heading, narration: m.narration });
    setOpen(m.id);
  }

  if (modules.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-6 shadow-card">
        <h2 className="text-sm font-bold text-ink">No induction modules yet</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Induction modules are the standard content every operative hears on
          every project — PPE expectations, behavioural standards, accident and
          near-miss reporting, housekeeping, manual handling and environmental
          awareness. They are written once here and included in every site’s
          induction alongside that project’s own hazards and arrangements.
        </p>
        {canIssue ? (
          <>
            <button
              type="button"
              onClick={() => call({ action: 'seed' }, 'seed')}
              disabled={busy !== null}
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {busy === 'seed' ? 'Creating…' : 'Create the six standard modules'}
            </button>
            <p className="mt-2 text-xs text-ink-subtle">
              They are created as <strong>drafts</strong> with suggested wording.
              Nothing reaches an induction until you have read each one and
              issued it.
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-ink-subtle">
            A Director can create the standard set.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger-700">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">Company induction modules</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Standard content, written once and included in every project’s
          induction alongside that site’s own hazards, emergency arrangements and
          local controls. A module only reaches an induction once it has been
          <strong> issued</strong>; editing creates a new revision, and previous
          revisions are kept so you can show exactly what an operative was told.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      {modules.map((m) => (
        <article key={m.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-bold text-ink">{m.title}</h3>
            {m.mandatory ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                Every site
              </span>
            ) : (
              <span className="text-xs text-ink-subtle">
                {m.defaultIncluded ? 'On by default' : 'Off by default'}
              </span>
            )}
            {!m.active && (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-subtle">
                Retired
              </span>
            )}
            <span className="ml-auto text-xs">
              {m.issued ? (
                <span className="font-semibold text-safe-700">
                  Issued · revision {m.issued.version}
                </span>
              ) : (
                <span className="font-semibold text-hivis-600">
                  Not issued — reaches nobody
                </span>
              )}
            </span>
          </div>

          <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">
            {m.narration}
          </p>

          <p className="mt-2 text-xs text-ink-subtle">
            {m.issued
              ? `In force since ${m.issued.issuedOn}${m.issued.issuedByName ? ` · issued by ${m.issued.issuedByName}` : ''}`
              : m.draft
                ? `Draft revision ${m.draft.version}, prepared by ${m.draft.preparedByName}`
                : 'No revision yet'}
            {m.revisionCount > 1 ? ` · ${m.revisionCount} revisions` : ''}
            {m.replacesSceneType
              ? ' · left out of a project that records its own arrangement for this'
              : ''}
          </p>

          {canDraft && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => (open === m.id ? setOpen(null) : edit(m))}
                disabled={busy !== null}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
              >
                {open === m.id ? 'Close' : m.draft ? 'Continue the draft' : 'Edit the wording'}
              </button>
              {canIssue && m.draft && (
                <button
                  type="button"
                  onClick={() => setIssuing(issuing === m.draft!.id ? null : m.draft!.id)}
                  className="rounded-lg bg-safe-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-safe-600"
                >
                  Issue revision {m.draft.version}
                </button>
              )}
            </div>
          )}

          {open === m.id && (
            <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
              <label className="block text-xs font-semibold text-ink" htmlFor={`h-${m.id}`}>
                Heading (shown on screen in the video)
              </label>
              <input
                id={`h-${m.id}`}
                value={draft.heading}
                onChange={(e) => setDraft((d) => ({ ...d, heading: e.target.value }))}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <label className="block text-xs font-semibold text-ink" htmlFor={`n-${m.id}`}>
                What is said. Written to be spoken aloud — short sentences, second
                person, no sub-clauses.
              </label>
              <textarea
                id={`n-${m.id}`}
                rows={7}
                value={draft.narration}
                onChange={(e) => setDraft((d) => ({ ...d, narration: e.target.value }))}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    const r = await call(
                      {
                        action: 'saveDraft',
                        revisionId: m.draft?.id,
                        heading: draft.heading,
                        narration: draft.narration,
                      },
                      `save-${m.id}`,
                    );
                    if (r) setOpen(null);
                  }}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {busy === `save-${m.id}` ? 'Saving…' : 'Save the draft'}
                </button>
                <span className="text-xs text-ink-subtle">
                  Saving does not change any induction. Issuing does.
                </span>
              </div>
            </div>
          )}

          {issuing && m.draft && issuing === m.draft.id && (
            <div className="mt-3 rounded-lg border border-safe-500/40 bg-safe-50 p-3">
              <label className="block text-xs font-semibold text-ink" htmlFor={`i-${m.id}`}>
                What changed in this revision? Kept on the module’s history.
              </label>
              <input
                id={`i-${m.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={note.trim().length < 5 || busy !== null}
                  onClick={async () => {
                    const r = await call(
                      { action: 'issue', revisionId: m.draft!.id, issueNote: note },
                      `issue-${m.id}`,
                    );
                    if (r) {
                      setIssuing(null);
                      setNote('');
                    }
                  }}
                  className="rounded-lg bg-safe-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {busy === `issue-${m.id}` ? 'Issuing…' : 'Issue it'}
                </button>
                <button
                  type="button"
                  onClick={() => setIssuing(null)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                >
                  Not yet
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                Every project’s induction will use these words from now on. The
                revision it replaces is kept, so a past induction can still be
                shown exactly as it was given.
              </p>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
