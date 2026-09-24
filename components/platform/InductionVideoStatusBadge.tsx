import { cn } from '@/lib/cn';

/**
 * Every status of an induction video, in one place.
 *
 * Phase 3's statuses are here already: the workflow is one state machine, and a
 * badge that cannot render VIDEO_READY would be a second, quieter definition of
 * the same thing.
 */
const LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  INFORMATION_REQUIRED: 'Information required',
  SCRIPT_GENERATING: 'Script generating',
  SCRIPT_READY: 'Ready for review',
  SCRIPT_APPROVED: 'Script approved',
  NARRATION_GENERATING: 'Narration generating',
  NARRATION_READY: 'Narrated',
  VIDEO_GENERATING: 'Video generating',
  VIDEO_READY: 'Video ready for review',
  PUBLISHED: 'Published',
  GENERATION_FAILED: 'Generation failed',
};

const TONE: Record<string, string> = {
  DRAFT: 'bg-surface-sunken text-ink-muted',
  INFORMATION_REQUIRED: 'bg-hivis-400/20 text-hivis-600',
  SCRIPT_GENERATING: 'bg-brand-50 text-brand-700',
  SCRIPT_READY: 'bg-brand-50 text-brand-700',
  SCRIPT_APPROVED: 'bg-safe-50 text-safe-700',
  NARRATION_GENERATING: 'bg-brand-50 text-brand-700',
  NARRATION_READY: 'bg-safe-50 text-safe-700',
  VIDEO_GENERATING: 'bg-brand-50 text-brand-700',
  VIDEO_READY: 'bg-brand-50 text-brand-700',
  PUBLISHED: 'bg-safe-50 text-safe-700',
  GENERATION_FAILED: 'bg-danger-50 text-danger-700',
};

export function InductionVideoStatusBadge({
  status,
  stale,
}: {
  status: string;
  /** The site's data has changed since this version was generated. */
  stale?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
          TONE[status] ?? 'bg-surface-sunken text-ink-muted',
        )}
      >
        {LABEL[status] ?? status}
      </span>
      {stale && (
        <span
          className="inline-flex whitespace-nowrap rounded-full bg-hivis-400/20 px-2 py-0.5 text-xs font-semibold text-hivis-600"
          title="The project's information has changed since this version was generated"
        >
          Out of date
        </span>
      )}
    </span>
  );
}
