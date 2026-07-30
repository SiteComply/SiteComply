import Link from 'next/link';
import {
  activityColour,
  type OccurrenceStatusValue,
} from '@/services/compliance/complianceConstants';
import { formatWeekdayShortUK, formatDateUK } from '@/lib/datetime';

/**
 * SC-020 Phase 1 — the "Upcoming (Next 7 Days)" panel from the REV-1 example:
 * date · activity · "Assigned to ...". The "View All" link is the ONLY route to a
 * list view, keeping the register a supporting surface rather than a competing
 * primary experience.
 */
export function UpcomingCompliance({
  items,
  viewAllHref,
}: {
  items: {
    id: string;
    templateId: string;
    title: string;
    dueDateLocal: string;
    assigneeLabel: string;
    status: OccurrenceStatusValue;
    overdue: boolean;
  }[];
  viewAllHref: string;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Upcoming (Next 7 Days)</h3>
        <Link
          href={viewAllHref}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          View All
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          Nothing scheduled in the next 7 days.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.slice(0, 8).map((it) => (
            <li
              key={it.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: activityColour(it.templateId) }}
              />
              <span className="shrink-0 font-medium text-ink-muted">
                {formatWeekdayShortUK(`${it.dueDateLocal}T12:00:00Z`)}{' '}
                {formatDateUK(`${it.dueDateLocal}T12:00:00Z`)}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                {it.title}
              </span>
              <span className="shrink-0 text-xs text-ink-subtle">
                Assigned to {it.assigneeLabel}
              </span>
              {it.overdue && (
                <span className="shrink-0 rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-700">
                  Overdue
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
