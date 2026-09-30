'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoStepper } from '@/components/inductionVideo/VideoStepper';
import { RefreshWhileWorking } from '@/components/inductionVideo/RefreshWhileWorking';
import type { ModuleVideoStage } from '@/services/inductionVideo/videoStageShape';

/**
 * THE WHOLE VIDEO WORKFLOW, ON THE MODULE'S OWN PAGE.
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
export function ModuleVideoPanel({
  moduleId,
  moduleTitle,
  video,
  canIssue,
  endpoint,
  videoApiBase,
}: {
  moduleId: string;
  moduleTitle: string;
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
    <section
      className={[
        'rounded-xl border bg-surface p-4 shadow-card',
        video.live ? 'border-safe-500/40' : 'border-brand-200',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Video</h3>
        <span className="text-xs font-semibold text-ink-muted">
          Step {video.step} of 8 · {video.label}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <VideoStepper
          step={video.step}
          working={video.working}
          failed={video.stage === 'FAILED'}
        />
      </div>

      <p className="mt-3 text-sm text-ink-muted">{video.detail}</p>

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
          <video
            controls
            preload="metadata"
            className="mt-2 w-full max-w-xs rounded-lg bg-black"
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
            <>
              <label
                className="mt-3 block text-xs font-semibold text-ink"
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
            </>
          )}
        </div>
      )}

      {/* ── THE ONE NEXT ACTION ── */}
      {next && (
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
                disabled={
                  busy !== null ||
                  (video.stage === 'PREVIEW' && note.trim().length < 5)
                }
                onClick={() =>
                  void run(
                    next.action as string,
                    /*
                     * Each action takes exactly what it needs: publishAndIssue and
                     * generateVideo act on the production, generateNarration on the
                     * MODULE, because it may still have to provision the asset and
                     * start the production before there is a videoId at all.
                     */
                    next.action === 'publishAndIssue'
                      ? { videoId: video.videoId, issueNote: note }
                      : next.action === 'generateVideo'
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
    </section>
  );
}
