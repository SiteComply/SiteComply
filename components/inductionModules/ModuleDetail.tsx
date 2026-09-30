'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ModuleWorkflowCard } from '@/components/inductionModules/ModuleWorkflowCard';
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
  videoApiBase,
}: {
  detail: Detail;
  canDraft: boolean;
  canIssue: boolean;
  endpoint: string;
  backHref: string;
  libraryBasePath: string;
  /** This tier's video media base, e.g. /api/platform/induction-video. */
  videoApiBase: string;
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

  /*
   * ── THE PAGE'S TWO WEIGHTS ────────────────────────────────────────────────
   *
   * One primary card (bordered, padded, first) and everything else in this quieter
   * shell. Previously all nine sections shared one class, which is the same as having
   * no hierarchy: the eye had nothing to land on and the workflow sat fifth.
   */
  const SECONDARY = 'rounded-xl border border-line bg-surface shadow-card';

  /*
   * THE WORDING IS PRIMARY ONLY WHILE IT IS THE JOB. At steps 1 and 2 it is what the
   * user came to do, so it is open. From step 3 the wording is settled and the video
   * is the work, so it folds away to one line — still one click, never hidden. Open
   * while editing regardless, or the editor would collapse under the person using it.
   */
  const wordingIsPrimary = detail.video.step <= 2 || editing;

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-xs font-semibold text-brand-700 hover:underline">
        ← All company modules
      </Link>

      {/*
        ── THE PRIMARY CARD: IDENTITY, STAGE, NEXT ACTION ──
        First on the page, and the only thing on it with a two-pixel border. It used to
        be two cards — a header here and the workflow FIFTH, below the usage statistics
        and the wording — so the question a user lands with ("what do I do?") was
        answered below the fold.
      */}
      <ModuleWorkflowCard
        moduleId={detail.id}
        moduleTitle={detail.title}
        subtitle={`${detail.slug} · ${detail.category} · ${
          detail.mandatory
            ? 'every site'
            : detail.defaultIncluded
              ? 'on by default'
              : 'off by default'
        }`}
        statusLabel={s.label}
        statusTone={TONE[s.tone]}
        statusDetail={s.detail}
        standsInFor={
          detail.standsInFor
            ? {
                title: detail.standsInFor.title,
                href: `${libraryBasePath}/${detail.standsInFor.assetId}`,
                hasIssuedRevision: detail.standsInFor.hasIssuedRevision,
              }
            : null
        }
        video={detail.video}
        canIssue={canIssue}
        endpoint={endpoint}
        videoApiBase={videoApiBase}
      />

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}


      {/*
        ── WHAT IT SAYS ──
        A native <details>, so progressive disclosure costs no JavaScript and the
        browser remembers nothing we have to manage. `open` is derived from the stage:
        see `wordingIsPrimary`.
      */}
      <details open={wordingIsPrimary} className={`${SECONDARY} p-4`}>
        <summary className="cursor-pointer">
          <span className="inline-flex flex-wrap items-center gap-2 align-middle">
          <h3 className="text-sm font-bold text-ink">
            {detail.inForce?.isDraft ? 'What it will say' : 'What it says'}
          </h3>
          {detail.inForce && (
            <span className="text-xs text-ink-subtle">
              revision {detail.inForce.version}
              {detail.inForce.isDraft ? ' · draft, not live' : ' · live'}
            </span>
          )}
          </span>
        </summary>

        {/*
          THE EDIT BUTTON IS OUTSIDE THE SUMMARY. A <button> inside one toggles the
          <details> as well as firing, so "Edit the wording" would have closed the very
          panel it opens the editor in.
        */}
        {canDraft && !editing && (
          <div className="mt-3 flex">
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
          </div>
        )}

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

        {/*
          ── DISCARD THIS DRAFT: THE ROUTINE UNDO ──
          Sits with the draft, because this is where somebody is standing when they
          read their own wording back and decide against it. Deliberately NOT part
          of Start again: that clears every revision and everything generated from
          them, which is far too big a hammer for an editing mistake, and it is the
          gap that made "reset the whole module" the only way to undo a bad draft.

          `canDraft`, not `canIssue` — the same authority that wrote it, and the
          same authority that can already overwrite every word of it.
        */}
        {canDraft && detail.draftDiscard && !editing && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-xs text-ink-muted">
              {detail.draftDiscard.leavesNothingWritten
                ? `Discarding draft revision ${detail.draftDiscard.version} leaves this module with nothing written, so it reaches no induction until something is issued.`
                : `Discarding draft revision ${detail.draftDiscard.version} changes nothing anybody hears — the issued revision stays in force, and no generated video is affected.`}
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Discard draft revision ${detail.draftDiscard?.version}? The wording in ` +
                      'it is deleted. Issued revisions are not affected. This cannot be undone.',
                  )
                ) {
                  return;
                }
                const done = await call(
                  {
                    action: 'discardDraft',
                    moduleId: detail.id,
                    revisionId: detail.draftDiscard?.revisionId,
                  },
                  'discardDraft',
                );
                /*
                 * Close the editor on success: it holds this revisionId, and leaving
                 * it open would let the next save post to a revision that is gone.
                 */
                if (done) setEditing(false);
              }}
              className="mt-2 rounded-lg border border-danger-300 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700 hover:bg-danger-50 disabled:opacity-50"
            >
              {busy === 'discardDraft' ? 'Discarding…' : 'Discard this draft'}
            </button>
          </div>
        )}
      </details>

      {/*
        ── WHERE IT IS USED ──
        Moved below the wording and folded away. It is a figure somebody checks, not
        something they act on, and it was sitting between the title and the work.
      */}
      <details className={`${SECONDARY} p-4`}>
        <summary className="cursor-pointer">
          <span className="inline-flex flex-wrap items-baseline gap-2 align-middle">
          <h3 className="text-sm font-bold text-ink">Where this module is used</h3>
          <span className="text-xs text-ink-subtle">
            {detail.usage.onProjects} of {detail.usage.totalProjects} projects
          </span>
          </span>
        </summary>
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
      </details>

      {/* ── THE HISTORY. One line until somebody wants it. ── */}
      <details className={`${SECONDARY} p-4`}>
        <summary className="cursor-pointer">
          <span className="inline-flex flex-wrap items-baseline gap-2 align-middle">
          <h3 className="text-sm font-bold text-ink">Revisions</h3>
          <span className="text-xs text-ink-subtle">
            {detail.revisions.length === 1
              ? '1 kept'
              : `${detail.revisions.length} kept`}
          </span>
          </span>
        </summary>
        <p className="mt-2 text-xs text-ink-subtle">
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
      </details>

      {/* ── SETTINGS. Folded: changed rarely, and never the reason you came here. ── */}
      {canIssue && (
        <details className={`${SECONDARY} p-4`}>
          <summary className="cursor-pointer text-sm font-bold text-ink">
            Settings
          </summary>
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
        </details>
      )}

      {/*
        ── START AGAIN: THE PRIMARY WAY TO CLEAR CONTENT ──
        The distinction the page has to make, because getting it wrong is
        irreversible:

          START AGAIN  the company still briefs on this subject; its WORDING and
                       everything generated from it should go.
          RETIRE       the company has stopped briefing on this subject.
          DELETE       the subject itself should never have existed.

        This panel comes first and is the ordinary action. Delete sits below it,
        behind a disclosure, described by what it means rather than offered as a
        way to restart — clearing a module's content used to require deleting a
        permanent company subject, which is the wrong verb for the intent.
      */}
      {canIssue && (
        <section className={`${SECONDARY} p-4`}>
          <h3 className="text-sm font-bold text-ink">Start again</h3>
          {detail.buildPhaseNotice && (
            <p className="mt-1 rounded-lg bg-surface-sunken px-2 py-1.5 text-xs text-ink-muted">
              {detail.buildPhaseNotice}
            </p>
          )}
          {detail.reset.resettable ? (
            <>
              <p className="mt-2 text-xs text-ink-muted">
                Clears{' '}
                <span className="font-semibold text-ink">
                  {detail.reset.revisions === 1
                    ? '1 revision'
                    : `all ${detail.reset.revisions} revisions`}
                </span>
                {detail.reset.productions > 0
                  ? ` and ${detail.reset.productions} video ${
                      detail.reset.productions === 1 ? 'production' : 'productions'
                    } generated from them`
                  : ''}
                , so this subject starts from a blank page at revision 1.
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Keeps the module itself, its subject, its running order, its inclusion
                rules
                {detail.reset.siteDecisionsKept > 0
                  ? ` and ${detail.reset.siteDecisionsKept} project ${
                      detail.reset.siteDecisionsKept === 1 ? 'decision' : 'decisions'
                    } about it`
                  : ''}
                .
              </p>
              {/*
                THE CONSEQUENCE NOBODY ELSE STATES. resolveModulesForSite skips a
                module with no issued revision, so clearing the wording silently
                drops the subject out of new inductions until something is issued
                again. For a mandatory subject that is worth seeing first.
              */}
              {detail.reset.wouldLeaveSubjectSilent && (
                <p className="mt-2 rounded-lg border border-hivis-500/40 bg-hivis-400/10 px-2 py-1.5 text-xs text-ink">
                  Until new wording is issued, this subject will not appear in any
                  induction generated from now on.
                </p>
              )}
              {detail.reset.producedVideos.length > 0 && (
                <p className="mt-2 text-xs text-ink-muted">
                  {detail.reset.producedVideos.map((v) => `“${v.title}”`).join(', ')} was
                  produced from this wording. Its issued footage is not cleared here — start
                  that video again on its own page.{' '}
                  {detail.reset.producedVideos.map((v) => (
                    <Link
                      key={v.id}
                      href={`${libraryBasePath}/${v.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      Open {v.title}
                    </Link>
                  ))}
                </p>
              )}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Start “${detail.title}” again? Its wording and everything generated ` +
                        'from it are deleted. The module, its settings and every project’s ' +
                        'decision about it are kept. This cannot be undone.',
                    )
                  ) {
                    return;
                  }
                  void call({ action: 'resetModule', moduleId: detail.id }, 'reset');
                }}
                className="mt-3 touch-target inline-flex items-center rounded-lg border border-danger-300 bg-surface px-3 py-2 text-xs font-semibold text-danger-700 hover:bg-danger-50 disabled:opacity-50"
              >
                {busy === 'reset' ? 'Clearing…' : 'Clear the content and start again'}
              </button>
            </>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">{detail.reset.blockedReason}</p>
          )}
        </section>
      )}

      {/*
        ── DELETE THE SUBJECT: A DISCLOSURE, NOT A BUTTON ──
        Native <details>, so it ships no JavaScript and is closed until somebody
        opens it. The summary says what deleting MEANS rather than naming the
        mechanism, because the wrong reason to press it is "I want to start again".
      */}
      {canIssue && (
        <details className={`${SECONDARY} p-4`}>
          <summary className="cursor-pointer text-sm font-semibold text-ink-muted">
            This subject is no longer wanted
          </summary>
          <div className="mt-3 border-t border-line pt-3">
            {detail.deletion.deletable ? (
              <>
                <p className="text-xs text-ink-muted">
                  Deletes the subject itself, with{' '}
                  {detail.deletion.issuedRevisions + detail.deletion.draftRevisions === 1
                    ? 'its wording'
                    : `all ${detail.deletion.issuedRevisions + detail.deletion.draftRevisions} revisions of its wording`}
                  {detail.deletion.siteDecisions > 0
                    ? `, and ${detail.deletion.siteDecisions} project ${
                        detail.deletion.siteDecisions === 1 ? 'decision' : 'decisions'
                      } about it`
                    : ''}
                  . To keep the subject and only clear its content, use Start again above.
                </p>
                {detail.deletion.unlinkedAssets.length > 0 && (
                  <p className="mt-2 text-xs text-ink-muted">
                    {detail.deletion.unlinkedAssets.join(', ')} will stop standing in for this
                    module and play alongside the rest of the induction instead.
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Delete “${detail.title}” permanently? Its wording and revision ` +
                          'history are deleted. This cannot be undone.',
                      )
                    ) {
                      return;
                    }
                    /*
                     * PUSH, NOT REFRESH. `call` refreshes, which on this page would
                     * re-render a module that no longer exists. The list is where the
                     * person now needs to be.
                     */
                    const done = await call(
                      { action: 'deleteModule', moduleId: detail.id },
                      'delete',
                    );
                    if (done) router.push(backHref);
                  }}
                  className="mt-3 touch-target inline-flex items-center rounded-lg border border-danger-500/40 px-3 py-2 text-xs font-semibold text-danger-600 hover:bg-danger-50 disabled:opacity-50"
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
                </button>
              </>
            ) : (
              <p className="text-xs text-ink-muted">{detail.deletion.blockedReason}</p>
            )}
          </div>
        </details>
      )}

    </div>
  );
}
