'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ModuleDetail as Detail } from '@/services/inductionModules/moduleDetail';

/**
 * ONE COMPANY MODULE, IN FULL.
 *
 * ── WHY THIS PAGE EXISTS ──────────────────────────────────────────────────
 *
 * There was no route for a single module. The wording of every module, its edit form
 * and its issue form were all on the landing page at once, so the page grew with the
 * catalogue and a module could not be linked to, bookmarked or sent to anybody. This
 * is where that weight went.
 *
 * ── EDITING IS DRAFTING ───────────────────────────────────────────────────
 *
 * There is no "save" that changes what operatives hear. Editing creates or updates a
 * draft; issuing is a separate, deliberate act with a note saying what changed, and
 * it is a Director's alone. The page says what issuing will do — and to how many
 * projects — before the button, composed in the loader so both tiers say it the same
 * way.
 *
 * Shared verbatim by the Platform and the Admin Centre. The only thing either passes
 * that differs is `endpoint`: which route the actions post to.
 */

const TONE: Record<string, string> = {
  good: 'bg-safe-50 text-safe-700 border-safe-200',
  working: 'bg-brand-50 text-brand-700 border-brand-200',
  attention: 'bg-hivis-400/15 text-ink border-hivis-500/50',
  neutral: 'bg-surface-sunken text-ink-muted border-line',
};

export function ModuleDetail({
  // Named `detail`, not `module`: Next forbids assigning to the identifier `module`
  // (it is the CommonJS global), and a destructured prop is an assignment. tsc and
  // every suite passed; only `next build` reports it.
  detail,
  canDraft,
  canIssue,
  endpoint,
  backHref,
  libraryBasePath,
}: {
  detail: Detail;
  canDraft: boolean;
  canIssue: boolean;
  endpoint: string;
  backHref: string;
  libraryBasePath: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    heading: detail.inForce?.heading ?? detail.title,
    narration: detail.inForce?.narration ?? '',
  });
  const [issuing, setIssuing] = useState(false);
  const [note, setNote] = useState('');
  const [openRevision, setOpenRevision] = useState<string | null>(null);

  async function call(body: Record<string, unknown>, key: string) {
    if (busy) return null;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(endpoint, {
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

  async function startEditing() {
    const started = await call({ action: 'startDraft', moduleId: detail.id }, 'draft');
    if (!started) return;
    setDraft({
      heading: detail.inForce?.heading ?? detail.title,
      narration: detail.inForce?.narration ?? '',
    });
    setEditing(true);
  }

  const s = detail.status;

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-xs font-semibold text-brand-700 hover:underline">
        ← All company modules
      </Link>

      {/* ── WHAT THIS IS, AND WHETHER IT REACHES ANYBODY ── */}
      <header className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink">{detail.title}</h2>
            <p className="mt-0.5 text-xs text-ink-subtle">
              {detail.slug} · {detail.category} ·{' '}
              {detail.mandatory
                ? 'every site'
                : detail.defaultIncluded
                  ? 'on by default'
                  : 'off by default'}
            </p>
          </div>
          <span
            className={`ml-auto rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE[s.tone]}`}
          >
            {s.label}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-muted">{s.detail}</p>

        {detail.standsInFor && (
          <p className="mt-3 rounded-lg border border-hivis-500/40 bg-hivis-400/10 px-3 py-2 text-xs text-ink">
            <span className="font-semibold">A library video stands in for this module.</span>{' '}
            {detail.standsInFor.hasIssuedRevision
              ? `Projects are shown “${detail.standsInFor.title}” instead of this wording, so an operative is not told the same thing twice.`
              : `“${detail.standsInFor.title}” is set to replace this, but it has no issued revision yet — so this wording is still what projects hear.`}{' '}
            <Link
              href={`${libraryBasePath}/${detail.standsInFor.assetId}`}
              className="font-semibold underline"
            >
              Open that library video
            </Link>
          </p>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      {/* ── WHERE IT IS USED. Counted with the same predicate that builds a real
             induction, so the figure cannot disagree with what a site gets. ── */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-sm font-bold text-ink">Where this module is used</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-subtle">Projects including it</dt>
            <dd className="text-lg font-bold text-ink">
              {detail.usage.onProjects}
              <span className="text-sm font-normal text-ink-subtle">
                {' '}
                of {detail.usage.totalProjects}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Revisions</dt>
            <dd className="text-lg font-bold text-ink">{detail.revisions.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Own wording recorded by</dt>
            <dd className="text-lg font-bold text-ink">{detail.usage.overriddenBy.length}</dd>
          </div>
        </dl>
        {detail.usage.excludedBy.length > 0 && (
          <p className="mt-3 text-xs text-ink-muted">
            <span className="font-semibold">Left out by:</span>{' '}
            {detail.usage.excludedBy.map((x) => x.siteName).join(', ')}
          </p>
        )}
        {detail.usage.overriddenBy.length > 0 && (
          <p className="mt-1 text-xs text-ink-muted">
            <span className="font-semibold">Own wording recorded by:</span>{' '}
            {detail.usage.overriddenBy.map((x) => x.siteName).join(', ')}
          </p>
        )}
        {detail.mandatory && (
          <p className="mt-3 text-xs text-ink-muted">
            This module is mandatory, so no project may leave it out.
          </p>
        )}
      </section>

      {/* ── WHAT IT SAYS. The reason this page exists. ── */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-ink">
            {detail.inForce?.isDraft ? 'What it will say' : 'What it says'}
          </h3>
          {detail.inForce && (
            <span className="text-xs text-ink-subtle">
              revision {detail.inForce.version}
              {detail.inForce.isDraft ? ' · draft, not live' : ' · live'}
            </span>
          )}
          {canDraft && !editing && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void startEditing()}
              className="ml-auto rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {busy === 'draft'
                ? 'Opening…'
                : detail.draftId
                  ? 'Continue the draft'
                  : 'Edit the wording'}
            </button>
          )}
        </div>

        {!editing ? (
          <>
            <p className="mt-3 text-xs font-semibold text-ink">Heading shown on screen</p>
            <p className="mt-1 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink">
              {detail.inForce?.heading ?? detail.title}
            </p>
            <p className="mt-3 text-xs font-semibold text-ink">What is said</p>
            <p className="mt-1 whitespace-pre-line rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
              {detail.inForce?.narration || 'Nothing written yet.'}
            </p>
          </>
        ) : (
          <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
            <label className="block text-xs font-semibold text-ink" htmlFor="module-heading">
              Heading (shown on screen in the video)
            </label>
            <input
              id="module-heading"
              value={draft.heading}
              onChange={(e) => setDraft((d) => ({ ...d, heading: e.target.value }))}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <label className="block text-xs font-semibold text-ink" htmlFor="module-narration">
              What is said. Written to be spoken aloud — short sentences, second person,
              no sub-clauses.
            </label>
            <textarea
              id="module-narration"
              rows={10}
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
                      revisionId: detail.draftId,
                      heading: draft.heading,
                      narration: draft.narration,
                    },
                    'save',
                  );
                  if (r) setEditing(false);
                }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {busy === 'save' ? 'Saving…' : 'Save the draft'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
              >
                Cancel
              </button>
              <span className="text-xs text-ink-subtle">
                Saving does not change any induction. Issuing does.
              </span>
            </div>
          </div>
        )}

        {/* ── ISSUING, WITH ITS CONSEQUENCE STATED FIRST ── */}
        {canIssue && detail.draftId && !editing && (
          <div className="mt-3 rounded-lg border border-safe-500/40 bg-safe-50 p-3">
            {detail.issueConsequence && (
              <p className="text-xs text-ink">{detail.issueConsequence}</p>
            )}
            {!issuing ? (
              <button
                type="button"
                onClick={() => setIssuing(true)}
                className="mt-2 rounded-lg bg-safe-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-safe-600"
              >
                Issue this revision
              </button>
            ) : (
              <>
                <label className="mt-2 block text-xs font-semibold text-ink" htmlFor="issue-note">
                  What changed in this revision? Kept on the module’s history.
                </label>
                <input
                  id="issue-note"
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
                        { action: 'issue', revisionId: detail.draftId, issueNote: note },
                        'issue',
                      );
                      if (r) {
                        setIssuing(false);
                        setNote('');
                      }
                    }}
                    className="rounded-lg bg-safe-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {busy === 'issue' ? 'Issuing…' : 'Issue it'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIssuing(false)}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                  >
                    Not yet
                  </button>
                </div>
                <p className="mt-2 text-xs text-ink-subtle">
                  The revision it replaces is kept, so a past induction can still be shown
                  exactly as it was given.
                </p>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── THE HISTORY. Every revision, and what each one was for. ── */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-sm font-bold text-ink">Revisions</h3>
        <p className="mt-0.5 text-xs text-ink-subtle">
          Previous revisions are kept so you can show exactly what an operative was told.
        </p>
        <ul className="mt-3 divide-y divide-line">
          {detail.revisions.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">Revision {r.version}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    r.status === 'ISSUED' && !r.supersededOn
                      ? TONE.good
                      : r.status === 'DRAFT'
                        ? TONE.attention
                        : TONE.neutral
                  }`}
                >
                  {r.status === 'DRAFT'
                    ? 'Draft'
                    : r.supersededOn
                      ? `Superseded ${r.supersededOn}`
                      : 'In force'}
                </span>
                <span className="text-xs text-ink-subtle">
                  {r.issuedOn
                    ? `Issued ${r.issuedOn}${r.issuedByName ? ` by ${r.issuedByName}` : ''}${
                        r.issuedByRealm ? ` (${r.issuedByRealm})` : ''
                      }`
                    : `Prepared ${r.preparedOn} by ${r.preparedByName}`}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenRevision(openRevision === r.id ? null : r.id)}
                  className="ml-auto text-xs font-semibold text-brand-700 hover:underline"
                >
                  {openRevision === r.id ? 'Hide what it said' : 'What it said'}
                </button>
              </div>
              {r.issueNote && (
                <p className="mt-1 text-xs text-ink-muted">“{r.issueNote}”</p>
              )}
              {openRevision === r.id && (
                <div className="mt-2 rounded-lg border border-line bg-surface-sunken p-3">
                  <p className="text-xs font-semibold text-ink">{r.heading}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">
                    {r.narration}
                  </p>
                  {r.events.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-line pt-2">
                      {r.events.map((e) => (
                        <li key={e.id} className="flex flex-wrap gap-2 text-xs">
                          <span className="font-semibold text-ink">
                            {e.action.replace(/_/g, ' ').toLowerCase()}
                          </span>
                          {e.detail && <span className="text-ink-muted">{e.detail}</span>}
                          <span className="ml-auto text-ink-subtle">
                            {e.actorName}
                            {e.actorRealm ? ` (${e.actorRealm})` : ''} · {e.at}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── SETTINGS. Where it is used, not what it says. ── */}
      {canIssue && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h3 className="text-sm font-bold text-ink">Settings</h3>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2 font-semibold text-ink">
              <input
                type="checkbox"
                defaultChecked={detail.mandatory}
                onChange={(e) =>
                  void call(
                    { action: 'settings', moduleId: detail.id, mandatory: e.target.checked },
                    'mandatory',
                  )
                }
              />
              Every project must include it
            </label>
            <label className="flex items-center gap-2 font-semibold text-ink">
              <input
                type="checkbox"
                defaultChecked={detail.defaultIncluded}
                disabled={detail.mandatory}
                onChange={(e) =>
                  void call(
                    {
                      action: 'settings',
                      moduleId: detail.id,
                      defaultIncluded: e.target.checked,
                    },
                    'default',
                  )
                }
              />
              On by default for new projects
            </label>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-xs text-ink-muted">{detail.retireConsequence}</p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void call(
                  { action: 'setActive', moduleId: detail.id, active: !detail.active },
                  'active',
                )
              }
              className="mt-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              {detail.active ? 'Retire this module' : 'Bring it back'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
