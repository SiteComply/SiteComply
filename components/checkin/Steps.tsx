import { cn } from '@/lib/cn';

/**
 * Compact, mobile-first progress indicator for the worker check-in journey.
 * Shows the four stages so a worker always knows how far they are and how much
 * is left — reassurance that the whole thing is quick.
 */
export const CHECKIN_STEPS = [
  'Verify',
  'Your details',
  'Choose site',
  'Induction',
] as const;

export type CheckinStep = (typeof CHECKIN_STEPS)[number];

export function Steps({ current }: { current: CheckinStep }) {
  const currentIndex = CHECKIN_STEPS.indexOf(current);

  return (
    <ol
      className="mb-6 flex items-center gap-1.5"
      aria-label={`Step ${currentIndex + 1} of ${CHECKIN_STEPS.length}: ${current}`}
    >
      {CHECKIN_STEPS.map((step, index) => {
        const state =
          index < currentIndex
            ? 'done'
            : index === currentIndex
              ? 'current'
              : 'upcoming';
        return (
          <li key={step} className="flex-1">
            <div
              className={cn(
                'h-1.5 rounded-full',
                state === 'done' && 'bg-safe-500',
                state === 'current' && 'bg-brand-600',
                state === 'upcoming' && 'bg-line',
              )}
            />
            <span
              className={cn(
                'mt-1.5 block text-[11px] font-medium',
                state === 'upcoming' ? 'text-ink-subtle' : 'text-ink',
              )}
            >
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
