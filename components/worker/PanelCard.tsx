import { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { WorkerIcon, type WorkerIconName } from './icons';

/**
 * Building blocks for the Worker Dashboard's card grid (SC-003).
 *
 * Every panel is the same shape — tinted icon, title, body, one forward link —
 * so a worker scanning the grid outdoors on a phone can find what they need by
 * position and colour rather than by reading every card. Tones map to the
 * SiteComply palette: brand blue for information, green for safe/complete, amber
 * for "needs attention", red for emergency.
 */
export type PanelTone = 'brand' | 'safe' | 'teal' | 'hivis' | 'danger';

const TONE_ICON: Record<PanelTone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  safe: 'bg-safe-50 text-safe-700',
  teal: 'bg-teal-50 text-teal-600',
  hivis: 'bg-hivis-400/20 text-hivis-600',
  danger: 'bg-danger-50 text-danger-600',
};

const TONE_VALUE: Record<PanelTone, string> = {
  brand: 'text-brand-700',
  safe: 'text-safe-600',
  teal: 'text-teal-600',
  hivis: 'text-hivis-600',
  danger: 'text-danger-600',
};

export function PanelCard({
  icon,
  tone = 'brand',
  title,
  href,
  linkLabel,
  children,
  className,
}: {
  icon: WorkerIconName;
  tone?: PanelTone;
  title: string;
  href?: string;
  linkLabel?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col rounded-xl border border-line bg-surface p-4 shadow-card',
        className,
      )}
    >
      <h2 className="flex items-center gap-2.5 text-sm font-bold text-ink">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            TONE_ICON[tone],
          )}
        >
          <WorkerIcon name={icon} className="h-5 w-5" />
        </span>
        {title}
      </h2>

      <div className="mt-3 flex-1 text-sm text-ink-muted">{children}</div>

      {href && linkLabel && (
        <Link
          href={href}
          className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
        >
          {linkLabel} →
        </Link>
      )}
    </section>
  );
}

/**
 * The big-number body used by the counting panels (permits, RAMS, documents,
 * actions, messages). `tone` colours the figure so an outstanding count reads
 * differently from a reassuring one.
 */
export function PanelMetric({
  value,
  label,
  tone = 'brand',
}: {
  value: number;
  label: string;
  tone?: PanelTone;
}) {
  return (
    <>
      <p
        className={cn(
          'text-3xl font-bold tabular-nums leading-none',
          value === 0 ? 'text-ink-subtle' : TONE_VALUE[tone],
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-sm text-ink-muted">{label}</p>
    </>
  );
}

/** A label/value line used inside the emergency and contact panels. */
export function PanelLine({
  icon,
  tone = 'brand',
  label,
  value,
}: {
  icon: WorkerIconName;
  tone?: PanelTone;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn('mt-0.5 shrink-0', TONE_VALUE[tone])}>
        <WorkerIcon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="break-words text-sm text-ink-muted">{value}</p>
      </div>
    </div>
  );
}

/** Consistent empty state for a panel with nothing to show yet. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>;
}

/** Page heading shared by the Worker Dashboard's detail pages. */
export function WorkerPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-5">
      <Link
        href="/worker/dashboard"
        className="text-sm font-semibold text-brand-700 hover:underline"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">{title}</h1>
      {description && <p className="text-ink-muted">{description}</p>}
    </header>
  );
}
