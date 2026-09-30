'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoStepper } from '@/components/inductionVideo/VideoStepper';
import { RefreshWhileWorking } from '@/components/inductionVideo/RefreshWhileWorking';
import type { ModuleVideoStage } from '@/services/inductionVideo/videoStageShape';

/**
 * THE MODULE'S PRIMARY CARD: WHAT IT IS, WHERE IT HAS GOT TO, WHAT TO DO NEXT.
 *
 * ── WHY IDENTITY AND WORKFLOW ARE ONE CARD, AT THE TOP ────────────────────
 *
 * They were two, and the workflow one was FIFTH on the page, below the header, the
 * usage statistics and a two-hundred-line wording panel. Every section wore the same
 * card chrome, so nothing looked more important than anything else and the one thing a
 * user needs on landing — what stage am I at, what do I press — was the thing they had
 * to scroll for.
 *
 * So the title, the stage and the action are one block now, and it is the first thing
 * on the page. Everything else moved below it and most of it is folded away.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * Five pages and three objects the user had no reason to know about. Writing wording
 * ended in a dead end; continuing meant knowing that a Library ASSET had to exist, be
 * marked GENERATED and point back at the module; then producing from the asset page;
 * then approving, narrating and rendering on a third; then pressing "Publish to
 * operatives", which filed a draft REVISION rather than publishing anything; then
 * finding the way back to the asset to issue it — which, until 2026-09-30, was
 * impossible because readiness asked for an uploaded file a generated video never
 * has. The workflow could not be completed at all.
 *
 * Now: one panel, one stage, one button. The asset is provisioned in the background,
 * the production is never named, and "publish" and "issue" are one act.
 *
 * ── IT ADVANCES ITSELF ────────────────────────────────────────────────────
 *
 * The two waits (narration, render) are queued jobs. `RefreshWhileWorking` polls the
 * cheap status endpoint and refreshes only when the fingerprint changes, so the stage
 * moves on by itself and the user is never told to reload. That component exists
 * because the first version of this page refreshed itself every three seconds and
 * starved the render it was watching.
 *
 * ── AND IT NEVER SHOWS A BUTTON IT WILL REFUSE ────────────────────────────
 *
 * `stage.next.directorOnly` is answered by the service. A Site Manager sees the stage
 * and the reason, not a control that fails. The services re-check regardless.
 */
export function ModuleWorkflowCard({
  moduleId,
  moduleTitle,
  subtitle,
  statusLabel,
  statusTone,
  statusDetail,
  standsInFor,
  video,
  canIssue,
  endpoint,
  videoApiBase,
}: {
  moduleId: string;
  moduleTitle: string;
  /** Slug · subject · how it is included. One quiet line under the title. */
  subtitle: string;
  /** The MODULE's own derived status, e.g. "Live". Distinct from the video's stage. */
  statusLabel: string;
  statusTone: string;
  /**
   * The module's state in a sentence, e.g. "Revision 1 is what operatives hear".
   * Kept when the old header was folded into this card: the chip alone says "Live",
   * which does not distinguish live from live-with-a-draft-waiting. One line, not a
   * panel — the clutter was nine equal cards, not this sentence.
   */
  statusDetail: string;
  /**
   * A library video that plays INSTEAD of this wording. Kept in the primary card
   * because it changes what the module DOES, which is not a detail.
   */
  standsInFor: { title: string; href: string; hasIssuedRevision: boolean } | null;
  video: ModuleVideoStage;
  /** A Director, or an Admin Centre owner/admin. */
  canIssue: boolean;
  /** Where module actions post, e.g. /api/platform/induction-modules. */
  endpoint: string;
  /** This tier's video media base, e.g. /api/platform/induction-video. */
  videoApiBase: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const next = video.next;
  const mayAct = next ? !next.directorOnly || canIssue : false;

  async function run(action: string, body: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(action);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return;
      }
      /*
       * A SUCCESS SENTENCE THAT NAMES THE EFFECT, not "Saved". The one that matters
       * is going live, because that is the moment operatives start seeing it and the
       * only moment the written wording stops being what they hear.
       */
      if (action === 'publishAndIssue') {
        setDone(
          `“${moduleTitle}” is live. Operatives now watch it instead of hearing the written wording.`,
        );
      }
      // The stage is derived, so a refresh IS the advance to the next step.
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    /*
     * HEAVIER THAN EVERYTHING BELOW IT, on purpose: a two-pixel brand edge and more
     * padding. Nine identically-bordered cards is the same as no hierarchy at all.
     */
    <section
      className={[
        'rounded-xl border-2 bg-surface p-5 shadow-card',
        video.live ? 'border-safe-500/50' : 'border-brand-200',
      ].join(' ')}
    >
      {/* ── WHAT THIS IS ── */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-tight text-ink">{moduleTitle}</h2>
          <p className="mt-1 text-xs text-ink-subtle">{subtitle}</p>
        </div>
        <span
          className={`ml-auto shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone}`}
        >
          {statusLabel}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{statusDetail}</p>

      {/* ── WHERE IT HAS GOT TO ── */}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-subtle">
          Step {video.step} of 8 · {video.label}
        </p>
        <div className="mt-2 overflow-x-auto">
          <VideoStepper
            step={video.step}
            working={video.working}
            failed={video.stage === 'FAILED'}
          />
        </div>
        <p className="mt-3 text-sm text-ink-muted">{video.detail}</p>
      </div>

      {done && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-safe-500/40 bg-safe-50 px-3 py-2 text-sm font-semibold text-safe-700"
        >
          {done}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </p>
      )}

      {/*
        THE WAIT. Polling keeps the stage current, and the estimate is said out loud
        so a two-minute render does not read as a hang.
      */}
      {video.working && video.videoId && (
        <div className="mt-3">
          <RefreshWhileWorking
            working
            label={video.detail}
            statusHref={`${videoApiBase}/${video.videoId}/status`}
          />
        </div>
      )}

      {/* ── REVIEW THE NARRATION: hear it and read it before spending a render. ── */}
      {video.stage === 'NARRATION_REVIEW' && video.videoId && (
        <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
          <p className="text-xs font-semibold text-ink">Check it before you build it</p>
          <p className="mt-1 text-xs text-ink-muted">
            The narration is read straight from the wording above, word for word. Read it
            back or check the subtitles if you want to be sure of the timing.
          </p>
          {/*
            No player here on purpose: the audio routes are per SCENE, and listing
            scenes would put the production's internals back on the page this redesign
            took them off. The transcript and the subtitles are the same content, and
            the finished video is playable at the next step.
          */}
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <a
              href={`${videoApiBase}/${video.videoId}/transcript`}
              className="font-semibold text-brand-700 hover:underline"
            >
              Read the transcript
            </a>
            <a
              href={`${videoApiBase}/${video.videoId}/captions`}
              className="font-semibold text-brand-700 hover:underline"
            >
              Subtitles
            </a>
          </div>
        </div>
      )}

      {/* ── PREVIEW: watch it, then one action publishes AND issues it. ── */}
      {video.stage === 'PREVIEW' && video.videoId && (
        <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
          <p className="text-xs font-semibold text-ink">Watch it through</p>
          {/*
            ── THE PLAYER IS CAPPED BY HEIGHT, AND SITS BESIDE THE NOTE ──
            An induction video is PORTRAIT, 1080x1920. At `max-w-xs` that is 320 wide
            and five hundred and sixty-nine tall, which pushed this card past a
            thousand pixels and put "Publish & issue" below the fold on a 1366x768
            laptop — measured at 677px against a 640px viewport, so the one action on
            the page needed a scroll to reach.

            Capping the HEIGHT instead fixes the tall dimension directly: 224px tall is
            126 wide at this aspect, which is ample to check a video you rendered and
            can open full-screen. Beside it rather than above it, so the row is as tall
            as the taller of the two rather than the sum.
          */}
          <div className="mt-2 sm:flex sm:items-start sm:gap-4">
          <video
            controls
            preload="metadata"
            className="max-h-48 w-auto rounded-lg bg-black"
            src={`${videoApiBase}/${video.videoId}/video`}
          >
            <track
              kind="captions"
              srcLang="en"
              label="English"
              default
              src={`${videoApiBase}/${video.videoId}/captions`}
            />
          </video>
          {mayAct && (
            <div className="mt-3 min-w-0 flex-1 sm:mt-0">
              <label
                className="block text-xs font-semibold text-ink"
                htmlFor="module-video-note"
              >
                What does this version say? Kept on the record.
              </label>
              <input
                id="module-video-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. First version, read from the issued wording."
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              />
              {/*
                THE ACTION SITS WITH THE NOTE IT DEPENDS ON, rather than in the generic
                block below. Two reasons, and the second is measurable: filling a field
                and then pressing the thing it feeds belongs together, and keeping the
                button out of a third row is what brings "Publish & issue" back above
                the fold on a 1366x768 laptop — it was at 685px against a 640px
                viewport, so the page's one action needed a scroll.
              */}
              <button
                type="button"
                disabled={busy !== null || note.trim().length < 5}
                onClick={() => void run('publishAndIssue', { videoId: video.videoId, issueNote: note })}
                className="mt-2 touch-target inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Publish & issue'}
              </button>
            </div>
          )}
          </div>
        </div>
      )}

      {/*
        ── THE ONE NEXT ACTION ──
        Skipped at PREVIEW, where the button lives beside the note it depends on.
      */}
      {next && video.stage !== 'PREVIEW' && (
        <div className="mt-3">
          {next.action === null ? (
            /*
             * Steps 1 and 2 are the wording, which this page already does above. So
             * the panel says what is needed rather than duplicating the editor and
             * giving two places to write the same words.
             */
            <p className="text-xs text-ink-subtle">
              {next.label} above to continue.
            </p>
          ) : mayAct ? (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    next.action as string,
                    /*
                     * Each action takes what it needs: generateVideo acts on the
                     * production, generateNarration on the MODULE, because it may
                     * still have to provision the asset and start the production
                     * before there is a videoId at all. publishAndIssue is not here —
                     * it lives beside the note it depends on, in the preview row.
                     */
                    next.action === 'generateVideo'
                      ? { videoId: video.videoId }
                      : { moduleId },
                  )
                }
                className="touch-target inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Working…' : next.label}
              </button>
              {next.estimate && (
                <p className="mt-1.5 text-xs text-ink-subtle">Takes {next.estimate}.</p>
              )}
            </>
          ) : (
            <p className="text-xs text-ink-subtle">
              {next.label} — only a Director can do this.
            </p>
          )}
        </div>
      )}

      {standsInFor && (
        <p className="mt-4 rounded-lg border border-hivis-500/40 bg-hivis-400/10 px-3 py-2 text-xs text-ink">
          <span className="font-semibold">A library video stands in for this module.</span>{' '}
          {standsInFor.hasIssuedRevision
            ? `Projects are shown “${standsInFor.title}” instead of this wording, so an operative is not told the same thing twice.`
            : `“${standsInFor.title}” is set to replace this, but it has nothing issued yet — so this wording is still what projects hear.`}{' '}
          <a href={standsInFor.href} className="font-semibold underline">
            Open it
          </a>
        </p>
      )}
    </section>
  );
}
