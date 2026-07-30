import { activityColour } from '@/services/compliance/complianceConstants';

/**
 * SC-020 Phase 1 — the "Activity Types" legend from the REV-1 example.
 *
 * In Phase 1 the schedulable unit IS an audit template, so the legend simply
 * lists the activity types in view. Colours come from the template id via the
 * validated SC-014 palette, so a type keeps its colour as the calendar is
 * filtered — identity is never conveyed by position.
 */
export function ActivityTypeLegend({
  types,
}: {
  types: { templateId: string; title: string }[];
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <h3 className="mb-2 text-sm font-bold text-ink">Activity Types</h3>
      {types.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          No activities scheduled in this period.
        </p>
      ) : (
        <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((t) => (
            <li key={t.templateId} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: activityColour(t.templateId) }}
              />
              <span className="min-w-0 truncate text-ink-muted">{t.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
