'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/Toast';
import {
  WORKER_DASHBOARD_PANELS,
  type PanelVisibility,
  type WorkerDashboardPanelValue,
} from '@/services/workerDashboard/dashboardPanels';

/**
 * Worker Dashboard configuration for one site (SC-003).
 *
 * Site managers switch each panel on or off; anything switched off disappears
 * from the worker's dashboard AND its sidebar. Each toggle saves on its own —
 * there is no Save button to forget — and the row reverts if the write fails.
 *
 * Check-out is locked on: a worker who cannot check out cannot end their
 * attendance record, which would leave them on the site's fire register.
 */
export function WorkerDashboardConfig({
  siteId,
  visibility,
  canEdit,
  variant = 'rows',
}: {
  siteId: string;
  visibility: PanelVisibility;
  canEdit: boolean;
  // 'rows' is the original long-row layout; 'compact' is the prototype
  // checkbox/grid layout (Worker Experience layout experiment, ?layout=v2).
  variant?: 'rows' | 'compact';
}) {
  const router = useRouter();
  const toast = useToast();
  const [panels, setPanels] = useState<PanelVisibility>(visibility);
  const [busy, setBusy] = useState<WorkerDashboardPanelValue | null>(null);

  async function toggle(panel: WorkerDashboardPanelValue, next: boolean) {
    const previous = panels[panel];
    setPanels((p) => ({ ...p, [panel]: next }));
    setBusy(panel);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/dashboard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panels: { [panel]: next } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPanels((p) => ({ ...p, [panel]: previous }));
        toast.error(data.error ?? 'Could not save that setting.');
        return;
      }
      if (data.visibility) setPanels(data.visibility as PanelVisibility);
      router.refresh();
    } catch {
      setPanels((p) => ({ ...p, [panel]: previous }));
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (variant === 'compact') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          Tick what workers see on their dashboard after checking into this
          site.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {WORKER_DASHBOARD_PANELS.map((panel) => {
            const on = panels[panel.value];
            const disabled = !canEdit || panel.locked || busy === panel.value;
            return (
              <label
                key={panel.value}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5',
                  disabled
                    ? 'opacity-70'
                    : 'cursor-pointer hover:bg-surface-sunken',
                )}
                title={panel.description}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  aria-label={`${panel.label} on the worker dashboard`}
                  onChange={(e) => toggle(panel.value, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-safe-500"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                    {panel.label}
                    {panel.locked && (
                      <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-subtle">
                        Always shown
                      </span>
                    )}
                    {panel.awaitingSourceSystem && (
                      <span className="rounded-full bg-hivis-400/25 px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                        No data yet
                      </span>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {!canEdit && (
          <p className="text-xs text-ink-subtle">
            You don’t have permission to change this site’s dashboard.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Choose what workers see on their dashboard after checking into this
        site.
      </p>

      <ul className="divide-y divide-line rounded-lg border border-line">
        {WORKER_DASHBOARD_PANELS.map((panel) => {
          const on = panels[panel.value];
          const disabled = !canEdit || panel.locked || busy === panel.value;
          return (
            <li
              key={panel.value}
              className="flex items-start justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {panel.label}
                  {panel.locked && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">
                      Always shown
                    </span>
                  )}
                  {panel.awaitingSourceSystem && (
                    <span className="rounded-full bg-hivis-400/25 px-2 py-0.5 text-[11px] font-semibold text-ink">
                      No data yet
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-subtle">{panel.description}</p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${panel.label} on the worker dashboard`}
                disabled={disabled}
                onClick={() => toggle(panel.value, !on)}
                className={cn(
                  'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                  on ? 'bg-safe-500' : 'bg-line',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                    on ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>

      {!canEdit && (
        <p className="text-xs text-ink-subtle">
          You don’t have permission to change this site’s dashboard.
        </p>
      )}
    </div>
  );
}
