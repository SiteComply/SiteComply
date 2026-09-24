'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The last two steps a manager takes: render it, then publish it.
 *
 * WATCHING IT IS THE REVIEW. There is no checklist here and no confirmation
 * dialogue listing what the video contains - a manager who has not watched the
 * thing cannot publish it responsibly, so the player is the largest thing on the
 * panel and Publish sits underneath it.
 *
 * PUBLISHING IS DESCRIBED IN TERMS OF WHO SEES IT. "Operatives will be shown
 * this version when they induct" says what actually happens; "publish" alone
 * could mean almost anything.
 */
export function RenderPanel({
  videoId,
  status,
  configured,
  stale,
  canPublish,
  durationLabel,
  sizeLabel,
  engine,
  renderedOn,
  publishedOn,
  publishedBy,
  watchedCount,
  completedCount,
  lastError,
}: {
  videoId: string;
  status: string;
  configured: boolean;
  /** The narration changed after the render: what exists is out of date. */
  stale: boolean;
  canPublish: boolean;
  durationLabel: string | null;
  sizeLabel: string | null;
  engine: string | null;
  renderedOn: string | null;
  publishedOn: string | null;
  publishedBy: string | null;
  watchedCount: number;
  completedCount: number;
  lastError: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState('');

  const narrated = status === 'NARRATION_READY';
  const rendering = status === 'VIDEO_GENERATING';
  const rendered = status === 'VIDEO_READY';
  const published = status === 'PUBLISHED';

  // Before narration there is nothing to render, so the panel stays out of the way.
  if (!narrated && !rendering && !rendered && !published) return null;

  async function call(body: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/platform/induction-video/${videoId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return;
      }
      setWithdrawing(false);
      setReason('');
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-bold text-ink">Video</h2>
        {(rendered || published) && (
          <span className="text-xs text-ink-muted">
            {[durationLabel, sizeLabel, engine, renderedOn].filter(Boolean).join(' · ')}
          </span>
        )}
        {!rendering && configured && (
          <button
            type="button"
            onClick={() => call({ action: 'render' }, 'render')}
            disabled={busy !== null || published}
            title={published ? 'Withdraw it before rendering a new file' : undefined}
            className="ml-auto rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          >
            {busy === 'render' ? 'Starting…' : rendered || published ? 'Render again' : 'Render video'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      {!configured && (
        <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          Video rendering is not configured on this deployment. The script,
          narration, subtitles and transcript all still work.
        </p>
      )}

      {lastError && !rendering && (
        <p className="mt-2 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          The last render did not finish: {lastError} The narration and the
          approval are untouched — trying again is safe.
        </p>
      )}

      {rendering && (
        <p className="mt-2 text-sm text-ink-muted">
          The video is being rendered. This runs in the background and takes a few
          minutes; refresh to see it.
        </p>
      )}

      {narrated && !rendering && configured && (
        <p className="mt-2 text-sm text-ink-muted">
          This version is narrated and ready to be rendered into a video for
          operatives.
        </p>
      )}

      {stale && (rendered || published) && (
        <p className="mt-2 rounded-lg border border-hivis-500/40 bg-hivis-400/10 px-3 py-2 text-sm text-ink">
          The words have changed since this video was rendered, so the file no
          longer matches the script. Render it again before publishing.
        </p>
      )}

      {(rendered || published) && (
        <>
          {/* Portrait, so the player is given a portrait frame rather than a
              letterbox: this is what an operative will hold. */}
          <div className="mt-3 flex justify-center">
            <video
              controls
              preload="metadata"
              playsInline
              className="max-h-[70vh] w-full max-w-[320px] rounded-xl bg-black"
              src={`/api/platform/induction-video/${videoId}/video`}
            >
              <track
                kind="captions"
                srcLang="en"
                label="English"
                default
                src={`/api/platform/induction-video/${videoId}/captions`}
              />
              Your browser cannot play this video.
            </video>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {published ? (
              <>
                <p className="text-sm text-safe-700">
                  <span className="font-semibold">Published.</span> Operatives are
                  shown this version when they induct
                  {publishedOn ? ` — ${publishedOn}` : ''}
                  {publishedBy ? ` by ${publishedBy}` : ''}.
                </p>
                {canPublish && !withdrawing && (
                  <button
                    type="button"
                    onClick={() => setWithdrawing(true)}
                    className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700"
                  >
                    Withdraw
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-ink-muted">
                  {canPublish
                    ? 'Watch it through, then publish it. Operatives will be shown this version when they induct, and every earlier version becomes history.'
                    : 'Only a Director or Site Manager may publish an induction video.'}
                </p>
                <button
                  type="button"
                  disabled={!canPublish || stale || busy !== null}
                  onClick={() => call({ action: 'publish' }, 'publish')}
                  className="ml-auto rounded-lg bg-safe-500 px-4 py-2 text-sm font-semibold text-white hover:bg-safe-600 disabled:opacity-40"
                >
                  {busy === 'publish' ? 'Publishing…' : 'Publish to operatives'}
                </button>
              </>
            )}
          </div>

          {withdrawing && (
            <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
              <label htmlFor="withdraw-reason" className="text-xs font-semibold text-ink">
                Why is it being withdrawn? This is kept on the version’s history.
              </label>
              <textarea
                id="withdraw-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={reason.trim().length < 5 || busy !== null}
                  onClick={() => call({ action: 'withdraw', reason }, 'withdraw')}
                  className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw it'}
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawing(false)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                >
                  Keep it published
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                Nothing is deleted. The file, the history and the record of who
                watched it all stay; operatives fall back to the written briefing
                screens until a version is published again.
              </p>
            </div>
          )}

          {watchedCount > 0 && (
            <p className="mt-3 text-xs text-ink-subtle">
              {completedCount} of {watchedCount} operative
              {watchedCount === 1 ? ' has' : 's have'} watched this version all the
              way through.
            </p>
          )}
        </>
      )}
    </section>
  );
}
