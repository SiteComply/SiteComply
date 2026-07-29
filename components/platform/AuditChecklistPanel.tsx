'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from '@/components/platform/icons';
import type { ItemResultValue } from '@/services/audits/scoringConstants';

export interface ChecklistItemRow {
  id: string;
  label: string;
  helpText: string | null;
  categoryLabel: string;
  sectionName: string | null;
  scoringRule: 'WEIGHTED' | 'PASS_FAIL' | 'INFO_ONLY';
  points: number;
  mandatory: boolean;
  result: ItemResultValue | null;
  pointsAwarded: number | null;
}

/**
 * SC-014 audit checklist with response capture. The auditor records Pass / Fail /
 * N/A per item; points awarded are derived on the server from the item's
 * configured points (never sent by the client), and the audit score recalculates
 * on every answer.
 *
 * Items are grouped by their weighted section so the checklist reads in the same
 * structure the scoring screen configures.
 */
export function AuditChecklistPanel({
  auditId,
  items,
  canEdit,
  scoringEnabled,
}: {
  auditId: string;
  items: ChecklistItemRow[];
  canEdit: boolean;
  scoringEnabled: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setResult(itemId: string, result: ItemResultValue | null) {
    setBusyId(itemId);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/audits/${auditId}/items/${itemId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result }),
        },
      );
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not record that answer.');
      } else {
        router.refresh();
      }
    } catch {
      setError('Could not record that answer.');
    } finally {
      setBusyId(null);
    }
  }

  // Preserve configured order while grouping by section.
  const groups: { name: string; rows: ChecklistItemRow[] }[] = [];
  for (const item of items) {
    const name = item.sectionName ?? 'Ungrouped';
    const existing = groups.find((g) => g.name === name);
    if (existing) existing.rows.push(item);
    else groups.push({ name, rows: [item] });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </p>
      )}

      {groups.map((group) => (
        <div key={group.name}>
          {groups.length > 1 && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              {group.name}
            </p>
          )}
          <ul className="divide-y divide-line">
            {group.rows.map((item) => (
              <li key={item.id} className="py-2.5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {item.label}
                      {item.mandatory && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-hivis-500/15 px-2 py-0.5 text-[11px] font-semibold text-hivis-600">
                          <PlatformIcon name="alert" className="h-3 w-3" />
                          Mandatory
                        </span>
                      )}
                    </p>
                    {item.helpText && (
                      <p className="text-xs text-ink-subtle">{item.helpText}</p>
                    )}
                    {scoringEnabled && (
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {item.scoringRule === 'INFO_ONLY'
                          ? 'Information only — no score impact'
                          : `${item.points} pt${item.points === 1 ? '' : 's'}${
                              item.pointsAwarded !== null
                                ? ` · ${item.pointsAwarded} awarded`
                                : ''
                            }`}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-subtle">
                    {item.categoryLabel}
                  </span>
                </div>

                {item.scoringRule !== 'INFO_ONLY' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(['PASS', 'FAIL', 'NA'] as const).map((value) => {
                      const active = item.result === value;
                      const tone =
                        value === 'PASS'
                          ? active
                            ? 'bg-safe-500 text-white border-safe-500'
                            : 'border-line text-ink-muted hover:bg-safe-50'
                          : value === 'FAIL'
                            ? active
                              ? 'bg-danger-600 text-white border-danger-600'
                              : 'border-line text-ink-muted hover:bg-danger-50'
                            : active
                              ? 'bg-ink-subtle text-white border-ink-subtle'
                              : 'border-line text-ink-muted hover:bg-surface-sunken';
                      return (
                        <button
                          key={value}
                          type="button"
                          disabled={!canEdit || busyId === item.id}
                          aria-pressed={active}
                          onClick={() =>
                            setResult(item.id, active ? null : value)
                          }
                          className={`rounded-lg border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
                        >
                          {value === 'NA'
                            ? 'N/A'
                            : value === 'PASS'
                              ? 'Pass'
                              : 'Fail'}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
