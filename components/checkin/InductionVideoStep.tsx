'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface InductionVideoInfo {
  videoId: string;
  version: number;
  durationMs: number;
  hasCaptions: boolean;
  required: boolean;
  furthestMs: number;
  completed: boolean;
}

/**
 * The site induction, watched.
 *
 * ── IT REPLACES THE WRITTEN BRIEFING, IT DOES NOT ADD TO IT ───────────────
 *
 * The video and the briefing screens are built from the same records and say the
 * same things. Showing both would tell an operative standing at a gate the same
 * thing twice and make the induction longer, which is the opposite of what was
 * asked for. So when a site publishes a video it takes the briefing's place -
 * and "read it instead" is always there, because a noisy site, a broken
 * earpiece or a preference for reading are all ordinary.
 *
 * ── PROGRESS IS REPORTED, NOT CLAIMED ─────────────────────────────────────
 *
 * This sends the player's position every few seconds and at the end. It never
 * says "completed": the server decides that from the position it is given, so a
 * modified page cannot produce an induction record for a video nobody watched.
 *
 * ── AND IT RESUMES ────────────────────────────────────────────────────────
 *
 * An operative whose signal drops halfway through a four-minute video returns to
 * where they were, not to the beginning. Anything else and they would skip it.
 */
export function InductionVideoStep({
  siteId,
  video,
  briefingFallback,
  onWatched,
}: {
  siteId: string;
  video: InductionVideoInfo;
  /** The written briefing, for anyone who would rather read it. */
  briefingFallback?: React.ReactNode;
  /** Called when the server confirms this counts as watched. */
  onWatched?: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [completed, setCompleted] = useState(video.completed);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSent = useRef(0);
  const resumed = useRef(false);

  const report = useCallback(
    async (positionMs: number, force = false) => {
      // Every few seconds at most: this fires from timeupdate, which a browser
      // raises four times a second.
      if (!force && Math.abs(positionMs - lastSent.current) < 5_000) return;
      lastSent.current = positionMs;
      try {
        const res = await fetch(`/api/worker/induction-video/${siteId}/progress`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ videoId: video.videoId, positionMs: Math.round(positionMs) }),
        });
        const data = await res.json().catch(() => null);
        if (data?.ok && data.completed && !completed) {
          setCompleted(true);
          onWatched?.();
        }
      } catch {
        // Losing a progress ping is not worth interrupting an induction for; the
        // next one carries the same high-water mark.
      }
    },
    [siteId, video.videoId, completed, onWatched],
  );

  // Send where they got to if they close the tab mid-way, so a part-watch is
  // still recorded as a part-watch.
  useEffect(() => {
    const onHide = () => {
      const el = ref.current;
      if (el && el.currentTime > 0) {
        navigator.sendBeacon?.(
          `/api/worker/induction-video/${siteId}/progress`,
          new Blob(
            [JSON.stringify({ videoId: video.videoId, positionMs: Math.round(el.currentTime * 1000) })],
            { type: 'application/json' },
          ),
        );
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [siteId, video.videoId]);

  const minutes = Math.round(video.durationMs / 60_000);
  const lengthLabel =
    video.durationMs < 60_000
      ? `${Math.round(video.durationMs / 1000)} seconds`
      : `${minutes} minute${minutes === 1 ? '' : 's'}`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Your site induction</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {lengthLabel} long. Watch it through — you will be asked to confirm you
          have understood it.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      <div className="flex justify-center">
        <video
          ref={ref}
          controls
          playsInline
          preload="metadata"
          className="max-h-[68vh] w-full max-w-[380px] rounded-xl bg-black"
          src={`/api/worker/induction-video/${siteId}/stream`}
          onLoadedMetadata={(e) => {
            // Resume where they left off, once, and never within the last few
            // seconds - restarting at 3:58 of a 4:00 video helps nobody.
            if (resumed.current) return;
            resumed.current = true;
            const el = e.currentTarget;
            const resumeAt = video.furthestMs / 1000;
            if (resumeAt > 5 && resumeAt < el.duration - 5) el.currentTime = resumeAt;
          }}
          onTimeUpdate={(e) => report(e.currentTarget.currentTime * 1000)}
          onEnded={(e) => report(e.currentTarget.currentTime * 1000, true)}
          onError={() =>
            setError(
              'The video could not be played. You can read the induction instead — the wording is the same.',
            )
          }
        >
          {video.hasCaptions && (
            <track
              kind="captions"
              srcLang="en"
              label="English"
              default
              src={`/api/worker/induction-video/${siteId}/captions`}
            />
          )}
          Your browser cannot play this video.
        </video>
      </div>

      {completed ? (
        <p className="rounded-lg border border-safe-500/40 bg-safe-50 px-3 py-2 text-sm font-semibold text-safe-700">
          Induction watched. You can carry on.
        </p>
      ) : (
        video.required && (
          <p className="rounded-lg border border-hivis-500/40 bg-hivis-400/10 px-3 py-2 text-sm text-ink">
            This site asks you to watch the induction through before you finish.
          </p>
        )
      )}

      {briefingFallback && (
        <div>
          <button
            type="button"
            onClick={() => setReading((r) => !r)}
            className="text-sm font-semibold text-brand-700 underline"
          >
            {reading ? 'Hide the written version' : 'Read it instead'}
          </button>
          {reading && (
            <div className="mt-3 rounded-xl border border-line bg-surface p-4">
              {briefingFallback}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
