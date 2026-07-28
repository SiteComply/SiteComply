'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  VALIDITY_PRESETS,
  VALIDITY_MIN_DAYS,
  VALIDITY_MAX_DAYS,
  validityLabel,
} from '@/services/induction/validityConstants';

export interface InductionValidityInitial {
  inductionValidityDays: number | null;
  invalidatedAtLabel: string | null;
  invalidatedByName: string | null;
}

/**
 * Site Details → Induction validity (SC-006). Lets a site manager set how long a
 * completed induction stays valid (so regular workers check in without repeating
 * it), and invalidate previous inductions after significant site changes so
 * everyone must re-induct. Writes go through the platform API then refresh.
 */
export function InductionValidityConfig({
  siteId,
  canEdit,
  initial,
}: {
  siteId: string;
  canEdit: boolean;
  initial: InductionValidityInitial;
}) {
  const router = useRouter();
  const toast = useToast();

  const presetDays = VALIDITY_PRESETS.map((p) => p.days);
  const initialMode: 'none' | 'preset' | 'custom' =
    initial.inductionValidityDays == null
      ? 'none'
      : presetDays.includes(initial.inductionValidityDays)
        ? 'preset'
        : 'custom';

  const [mode, setMode] = useState<'none' | 'preset' | 'custom'>(initialMode);
  const [presetValue, setPresetValue] = useState<number>(
    initial.inductionValidityDays != null &&
      presetDays.includes(initial.inductionValidityDays)
      ? initial.inductionValidityDays
      : VALIDITY_PRESETS[2].days, // default preset: 1 month
  );
  const [customDays, setCustomDays] = useState<number>(
    initialMode === 'custom' ? (initial.inductionValidityDays as number) : 90,
  );
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function selectedDays(): number | null {
    if (mode === 'none') return null;
    if (mode === 'preset') return presetValue;
    return customDays;
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/platform/sites/${siteId}/induction-validity`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'validity', days: selectedDays() }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save.');
        return;
      }
      toast.success('Induction validity saved.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function invalidate() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/platform/sites/${siteId}/induction-validity`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'invalidate' }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not invalidate.');
        return;
      }
      toast.success('Previous inductions invalidated.');
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Set how long a completed induction stays valid. Within the period,
        workers who have already inducted check in without repeating it.
        Currently:{' '}
        <span className="font-semibold text-ink">
          {validityLabel(initial.inductionValidityDays)}
        </span>
        .
      </p>

      <div className="space-y-3 rounded-lg border border-line p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="validityMode"
            checked={mode === 'none'}
            disabled={!canEdit || busy}
            onChange={() => setMode('none')}
          />
          <span>
            <span className="font-semibold text-ink">Every check-in</span>{' '}
            <span className="text-ink-subtle">
              — workers re-induct each time (default).
            </span>
          </span>
        </label>

        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="radio"
            name="validityMode"
            checked={mode === 'preset'}
            disabled={!canEdit || busy}
            onChange={() => setMode('preset')}
          />
          <span className="font-semibold text-ink">Valid for</span>
          <select
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink disabled:opacity-60"
            value={presetValue}
            disabled={!canEdit || busy || mode !== 'preset'}
            onChange={(e) => setPresetValue(Number(e.target.value))}
          >
            {VALIDITY_PRESETS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="radio"
            name="validityMode"
            checked={mode === 'custom'}
            disabled={!canEdit || busy}
            onChange={() => setMode('custom')}
          />
          <span className="font-semibold text-ink">Custom</span>
          <input
            type="number"
            min={VALIDITY_MIN_DAYS}
            max={VALIDITY_MAX_DAYS}
            className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink disabled:opacity-60"
            value={customDays}
            disabled={!canEdit || busy || mode !== 'custom'}
            onChange={(e) => setCustomDays(Number(e.target.value))}
          />
          <span className="text-ink-subtle">days</span>
        </label>

        {canEdit && (
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save validity'}
          </Button>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-line p-3">
        <p className="text-sm font-semibold text-ink">
          Invalidate previous inductions
        </p>
        <p className="text-xs text-ink-subtle">
          After a significant site change, force every worker to complete the
          latest induction before their next check-in.
        </p>
        {initial.invalidatedAtLabel && (
          <p className="text-xs text-ink-muted">
            Last invalidated {initial.invalidatedAtLabel}
            {initial.invalidatedByName
              ? ` by ${initial.invalidatedByName}`
              : ''}
            .
          </p>
        )}
        {canEdit && (
          <button
            type="button"
            className="touch-target inline-flex items-center rounded-lg border-2 border-danger-500 px-3 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            Invalidate previous inductions
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Invalidate previous inductions?"
        message="Every worker will have to complete the latest induction (including the knowledge check) before they can check in to this site again. This cannot be undone."
        confirmLabel={busy ? 'Working…' : 'Invalidate'}
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={invalidate}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
