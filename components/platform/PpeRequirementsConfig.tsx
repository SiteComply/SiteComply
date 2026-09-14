'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { PpeRequirement } from '@/services/checklists/sitePpeService';

/**
 * Owner Review Item 15 — the PPE a site requires.
 *
 * Presented as PPE, not as checklist rows. The same data was already editable in
 * the Admin Centre's generic builder, as one option in a type dropdown, which is
 * why nobody could find it: a manager looking for "site PPE" does not go looking
 * for "checklist item, type: PPE confirmation", in a portal they cannot sign in
 * to.
 *
 * Required vs optional is the only per-item setting, because it is the only one
 * the induction actually uses: a required item blocks the screen until it is
 * confirmed, an optional one does not.
 */
export function PpeRequirementsConfig({
  siteId,
  initial,
  defaults,
  canEdit,
}: {
  siteId: string;
  initial: PpeRequirement[];
  defaults: PpeRequirement[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<PpeRequirement[]>(initial);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(items) !== JSON.stringify(initial);

  function update(i: number, patch: Partial<PpeRequirement>) {
    setItems((list) => list.map((x, n) => (n === i ? { ...x, ...patch } : x)));
    setError(null);
  }
  function remove(i: number) {
    setItems((list) => list.filter((_, n) => n !== i));
    setError(null);
  }
  function move(i: number, delta: number) {
    setItems((list) => {
      const next = [...list];
      const j = i + delta;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }
  function add() {
    const label = newLabel.trim();
    if (label.length < 2) return;
    if (items.some((x) => x.label.toLowerCase() === label.toLowerCase())) {
      setError(`"${label}" is already listed.`);
      return;
    }
    setItems((list) => [...list, { label, helpText: null, required: true }]);
    setNewLabel('');
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/ppe`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not save the PPE requirements.');
        return;
      }
      toast.success(
        data.newVersion
          ? `PPE saved. Published as induction version ${data.version}, because operatives have already inducted against the previous one.`
          : 'PPE requirements saved.',
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* The workspace already renders this section's name and one-line
          description, so this says what that cannot: what Required does, and
          that editing can publish a new induction version. */}
      <p className="text-sm text-ink-muted">
        Each item is ticked individually during the induction.{' '}
        <span className="font-semibold text-ink">Required</span> items must be
        confirmed before an operative can check in; the rest are optional.
        Changes apply to the next induction — operatives who have already
        inducted are not asked again until their induction expires.
      </p>

      {items.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface-sunken p-4">
          <p className="text-sm text-ink-muted">
            No PPE is required on this project yet.
          </p>
          {canEdit && defaults.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => setItems(defaults)}
              disabled={busy}
            >
              Use the standard UK list
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li
              key={`${item.label}-${i}`}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
            >
              <span className="flex-1 font-semibold text-ink">{item.label}</span>

              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={item.required}
                  disabled={!canEdit || busy}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                Required
              </label>

              {canEdit && (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${item.label} up`}
                    disabled={i === 0 || busy}
                    onClick={() => move(i, -1)}
                    className={cn(
                      'touch-target rounded-md border border-line px-2 py-1 text-sm',
                      i === 0 ? 'opacity-40' : 'hover:bg-surface-sunken',
                    )}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} down`}
                    disabled={i === items.length - 1 || busy}
                    onClick={() => move(i, 1)}
                    className={cn(
                      'touch-target rounded-md border border-line px-2 py-1 text-sm',
                      i === items.length - 1 ? 'opacity-40' : 'hover:bg-surface-sunken',
                    )}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    disabled={busy}
                    onClick={() => remove(i)}
                    className="touch-target rounded-md border border-danger-500 px-2 py-1 text-sm font-semibold text-danger-600 hover:bg-danger-50"
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium text-ink">
              Add PPE
            </span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="e.g. Cut-resistant gloves"
              disabled={busy}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <Button
            variant="secondary"
            onClick={add}
            disabled={busy || newLabel.trim().length < 2}
          >
            Add
          </Button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700"
        >
          {error}
        </p>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save PPE requirements'}
          </Button>
          {dirty && (
            <span className="text-sm text-ink-muted">Unsaved changes</span>
          )}
        </div>
      )}
    </div>
  );
}
