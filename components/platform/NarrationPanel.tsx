'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface NarratedScene {
  id: string;
  heading: string;
  /** "0:42", or null when this scene has no audio yet. */
  duration: string | null;
}

/**
 * The narration stage: hearing what an operative will hear.
 *
 * A REVIEWER LISTENS SCENE BY SCENE, because that is how a mistake is found. A
 * single forty-minute file would be skipped to the middle and approved; a
 * per-scene player means the asbestos scene can be checked as the asbestos
 * scene.
 *
 * THE COST IS SHOWN BEFORE THE BUTTON IS PRESSED, and a re-narration says which
 * scenes it will pay for again. Spending somebody's money on their behalf should
 * never be a surprise, and the estimate is the same figure the usage row will
 * record.
 */
export function NarrationPanel({
  videoId,
  status,
  configured,
  scenes,
  totalLabel,
  voice,
  narratedOn,
  hasCaptions,
  hasTranscript,
  estimatePence,
  lastError,
  endpoint,
}: {
  videoId: string;
  status: string;
  /** False when this deployment has no speech service configured. */
  configured: boolean;
  /**
   * Which tier this is mounted in: the Platform's route or the Admin Centre's.
   *
   * Both accept identical bodies and run identical actions through one shared
   * dispatcher - only the realm the caller is authenticated in differs - so ONE
   * component serves both and there is no second copy to keep in step.
   */
  endpoint: string;
  scenes: NarratedScene[];
  totalLabel: string | null;
  voice: string | null;
  narratedOn: string | null;
  hasCaptions: boolean;
  hasTranscript: boolean;
  /** What generating the missing scenes would cost, in pence. */
  estimatePence: number;
  lastError: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approved = status === 'SCRIPT_APPROVED';
  const generating = status === 'NARRATION_GENERATING';
  const ready = status === 'NARRATION_READY';

  // Before approval there is nothing to say here: the words are not settled, so
  // an empty narration panel would only be noise on the page.
  if (!approved && !generating && !ready) return null;

  async function narrate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'narrate' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not start the narration.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-bold text-ink">Narration</h2>
        {ready && totalLabel && (
          <span className="text-xs text-ink-muted">
            {totalLabel}
            {voice ? ` · ${voice}` : ''}
            {narratedOn ? ` · ${narratedOn}` : ''}
          </span>
        )}
        {!generating && configured && (
          <button
            type="button"
            onClick={narrate}
            disabled={busy}
            className="ml-auto rounded-lg bg-safe-500 px-3 py-2 text-sm font-semibold text-white hover:bg-safe-600 disabled:opacity-40"
          >
            {busy ? 'Starting…' : ready ? 'Re-narrate' : 'Generate narration'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      {lastError && !generating && (
        <p className="mt-2 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          The last narration did not finish: {lastError} Scenes that were
          completed are kept, so trying again only pays for the rest.
        </p>
      )}

      {!configured && (
        <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          Narration is not configured on this deployment yet, so the script
          cannot be spoken. Everything else on this page still works.
        </p>
      )}

      {generating && (
        <p className="mt-2 text-sm text-ink-muted">
          The script is being read aloud. This runs in the background, a scene at
          a time; refresh to see it.
        </p>
      )}

      {approved && !generating && configured && (
        <p className="mt-2 text-sm text-ink-muted">
          The approved script has not been narrated yet.{' '}
          {estimatePence > 0 && (
            <>
              Generating it costs about {formatPence(estimatePence)} at the
              current rate.
            </>
          )}
        </p>
      )}

      {ready && (
        <>
          <ul className="mt-3 divide-y divide-line">
            {scenes.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="text-sm font-semibold text-ink">{s.heading}</span>
                <span className="text-xs text-ink-subtle">{s.duration ?? 'No audio'}</span>
                {s.duration && (
                  <audio
                    controls
                    preload="none"
                    className="ml-auto h-8 w-full max-w-[16rem]"
                    src={`/api/platform/induction-video/${videoId}/audio/${s.id}`}
                  >
                    Your browser cannot play audio.
                  </audio>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {hasTranscript && (
              <a
                href={`/api/platform/induction-video/${videoId}/transcript`}
                className="font-semibold text-brand-700 hover:underline"
              >
                Download the transcript
              </a>
            )}
            {hasCaptions && (
              <a
                href={`/api/platform/induction-video/${videoId}/captions`}
                className="font-semibold text-brand-700 hover:underline"
              >
                Subtitles (WebVTT)
              </a>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            Subtitles and the transcript are generated with the narration, from
            the same words and the same timings. Re-narrating reuses every scene
            that has not changed, so a corrected sentence costs one scene.
          </p>
        </>
      )}
    </section>
  );
}

function formatPence(pence: number): string {
  return pence < 100 ? `${pence}p` : `£${(pence / 100).toFixed(2)}`;
}
