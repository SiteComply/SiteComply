'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  buildRuleRows,
  type LibraryRule,
  type RuleRow,
  type SiteRule,
} from '@/services/checklists/siteRulesService';

/**
 * Site Rules Library — the rules shown to an operative during induction.
 *
 * Presented as a LIBRARY WITH TICKS rather than a list you build from nothing.
 * Most sites want most of the standard rules, so the work should be deselecting
 * the two that do not apply, not typing thirteen that do. Custom rules sit in the
 * same list underneath, because to the operative reading them at 7am there is no
 * such thing as a library rule and a custom one — there are just the site's rules.
 *
 * Deselecting is not deleting: an unticked library rule stays in the list so it
 * can be put back. A custom rule has no such home to return to, so it is removed
 * outright.
 *
 * THREE ORIGINS, one list. A row is a universal default (no badge), an optional
 * template the site may adopt ("Optional"), or a rule typed for this site
 * ("Site-specific"). Badged rather than split into separate sections, because the
 * order of this list IS the order the rules are read at induction, and the
 * reorder controls have to be able to move any rule anywhere — a site's own rule
 * may well belong at the top. Sections would either break that or make the
 * arrows lie.
 */

export function SiteRulesConfig({
  siteId,
  initial,
  library,
  acknowledged,
  canEdit,
}: {
  siteId: string;
  initial: SiteRule[];
  library: LibraryRule[];
  /** Does the induction still carry the acknowledgement that covers these? */
  acknowledged: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const initialRows = useMemo(
    () => buildRuleRows(initial, library),
    [initial, library],
  );
  const [rows, setRows] = useState<RuleRow[]>(initialRows);
  const [newRule, setNewRule] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = rows.filter((r) => r.selected);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initialRows);

  /** Selected rules, in the order the list shows them. */
  function payload(): SiteRule[] {
    return selected.map((r) => ({ label: r.label, helpText: r.helpText }));
  }

  function toggle(index: number) {
    setRows((list) =>
      list.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r)),
    );
    setError(null);
  }
  function removeCustom(index: number) {
    setRows((list) => list.filter((_, i) => i !== index));
    setError(null);
  }
  function move(index: number, delta: number) {
    setRows((list) => {
      const next = [...list];
      const j = index + delta;
      if (j < 0 || j >= next.length) return list;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
    setError(null);
  }
  function addCustom() {
    const label = newRule.trim();
    if (label.length < 3) return;
    if (rows.some((r) => r.label.trim().toLowerCase() === label.toLowerCase())) {
      setError(`"${label}" is already listed.`);
      return;
    }
    setRows((list) => [
      ...list,
      { label, helpText: null, selected: true, custom: true, optional: false },
    ]);
    setNewRule('');
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/rules`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules: payload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not save the site rules.');
        return;
      }
      toast.success(
        data.newVersion
          ? `Site rules saved. Published as induction version ${data.version}, because operatives have already inducted against the previous one.`
          : 'Site rules saved.',
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Selected rules are shown to operatives during their induction and must be
        acknowledged before they are given access to site.
      </p>

      {!acknowledged && selected.length > 0 && (
        <p
          role="status"
          className="rounded-lg border border-hivis-500/40 bg-hivis-500/10 px-3 py-2 text-sm text-ink"
        >
          This site’s induction no longer contains the site rules
          acknowledgement, so these rules are shown but nothing records that an
          operative agreed to them. Add it back in the induction checklist to
          restore the record.
        </p>
      )}

      <p className="text-sm font-semibold text-ink">
        {selected.length === 0
          ? 'No rules are shown at induction.'
          : `${selected.length} ${selected.length === 1 ? 'rule' : 'rules'} shown at induction`}
      </p>

      <ul className="space-y-2">
        {rows.map((row, i) => (
          <li
            key={`${row.label}-${i}`}
            className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface p-3"
          >
            <input
              type="checkbox"
              aria-label={`Show "${row.label}" at induction`}
              className="mt-1 h-5 w-5 shrink-0 rounded border-line"
              checked={row.selected}
              disabled={!canEdit || busy}
              onChange={() => toggle(i)}
            />
            <span className="min-w-0 flex-1">
              {/* Deliberately identical whether or not the rule is selected. A
                  strikethrough, or grey text, reads as "deleted" or "no longer
                  valid" - which is not what an unticked rule is. It is a rule
                  this site has chosen not to show. The checkbox carries that
                  distinction on its own, which is the whole job of a checkbox. */}
              <span className="block text-sm font-medium text-ink">
                {row.label}
              </span>
              {row.helpText && (
                <span className="mt-0.5 block text-sm text-ink-muted">
                  {row.helpText}
                </span>
              )}
              {(row.custom || row.optional) && (
                <span className="mt-1 inline-block rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-muted">
                  {row.custom ? 'Site-specific' : 'Optional'}
                </span>
              )}
            </span>

            {canEdit && (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move "${row.label}" up`}
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
                  aria-label={`Move "${row.label}" down`}
                  disabled={i === rows.length - 1 || busy}
                  onClick={() => move(i, 1)}
                  className={cn(
                    'touch-target rounded-md border border-line px-2 py-1 text-sm',
                    i === rows.length - 1 ? 'opacity-40' : 'hover:bg-surface-sunken',
                  )}
                >
                  ↓
                </button>
                {row.custom && (
                  /* Only a site-specific rule is removable. Unticking a standard
                     one already takes it off the induction, and keeping the row
                     is what lets somebody put it back. */
                  <button
                    type="button"
                    aria-label={`Remove "${row.label}"`}
                    disabled={busy}
                    onClick={() => removeCustom(i)}
                    className="touch-target rounded-md border border-danger-500 px-2 py-1 text-sm font-semibold text-danger-600 hover:bg-danger-50"
                  >
                    Remove
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium text-ink">
              Add a rule for this site
            </span>
            <input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="e.g. No deliveries through the school gate before 9am."
              disabled={busy}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <Button
            variant="secondary"
            onClick={addCustom}
            disabled={busy || newRule.trim().length < 3}
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
            {busy ? 'Saving…' : 'Save site rules'}
          </Button>
          {dirty && (
            <span className="text-sm text-ink-muted">Unsaved changes</span>
          )}
        </div>
      )}

      <p className="text-sm text-ink-subtle">
        Longer reference material — working hours, welfare, site-specific
        procedures — belongs in the Site rules field on{' '}
        <span className="font-medium text-ink-muted">Site information</span>,
        which operatives can read at any time. This list is the short set they are
        shown at induction.
      </p>
    </div>
  );
}
