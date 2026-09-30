import { VIDEO_STEPS } from '@/services/inductionVideo/videoStageShape';

/**
 * THE EIGHT STEPS, WITH ONE OF THEM LIT.
 *
 * ── WHY A STEPPER AND NOT A STATUS BADGE ──────────────────────────────────
 *
 * A badge answers "what state is this in". It does not answer the two questions a
 * first-time user actually has: how much of this is left, and am I nearly done. The
 * old flow could only answer them by reading four separate status vocabularies
 * across three pages, so nobody could tell whether "VIDEO_READY, revision DRAFT"
 * meant one more click or five.
 *
 * Purely presentational: no state, no handlers, no data of its own. It renders the
 * stage it is given, so it cannot disagree with the panel beside it.
 *
 * ── LEGIBLE WITHOUT COLOUR ────────────────────────────────────────────────
 *
 * Done steps carry a tick, the current one its number in a filled circle, the rest a
 * plain number. The brand fills sit below AA on white by the owner's standing
 * decision, so the state is never carried by colour alone.
 */
export function VideoStepper({
  step,
  working,
  failed,
}: {
  /** 1-8. */
  step: number;
  /** A job is running at this step, so it reads as in progress rather than waiting. */
  working?: boolean;
  /** Something went wrong at this step. */
  failed?: boolean;
}) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2" aria-label="Video progress">
      {VIDEO_STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li
            key={label}
            className="flex items-center gap-1.5"
            aria-current={current ? 'step' : undefined}
          >
            <span
              className={[
                'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                done
                  ? 'border-safe-500/50 bg-safe-50 text-safe-700'
                  : current
                    ? failed
                      ? 'border-danger-500/50 bg-danger-50 text-danger-700'
                      : 'border-brand-600 bg-brand-600 text-white'
                    : 'border-line bg-surface text-ink-subtle',
              ].join(' ')}
            >
              {done ? '✓' : failed && current ? '!' : n}
            </span>
            <span
              className={[
                'text-[11px]',
                current ? 'font-bold text-ink' : done ? 'text-ink-muted' : 'text-ink-subtle',
              ].join(' ')}
            >
              {label}
              {current && working && '…'}
            </span>
            {n < VIDEO_STEPS.length && (
              <span aria-hidden className="px-0.5 text-[11px] text-ink-subtle">
                ›
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
