'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import type { RiskTopicRow } from '@/services/sites/cppRiskService';

/**
 * CPP Tier 2 — the significant-risk register editor.
 *
 * TYPE-ONLY IMPORT of the service, and it must stay that way. cppRiskService
 * reaches lib/prisma, so a VALUE import from here fails the webpack build
 * outright while tsc stays green — the trap that broke the Site Rules build. The
 * labels come from the rows the server sends, not from importing the catalogue.
 *
 * TWENTY-FIVE TOPICS IS A LONG FORM, and that is the cost of the standard rather
 * than a design failure: the value of L153's list is that a topic cannot be
 * omitted by not being thought of. Two things keep it workable — the rare topics
 * (diving, caissons, explosives) collapse behind a disclosure, and each topic
 * saves on its own, so the register can be worked through over several sittings.
 */
export function SiteRiskRegister({
  siteId,
  initial,
  canEdit,
}: {
  siteId: string;
  initial: RiskTopicRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<RiskTopicRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRare, setShowRare] = useState(false);

  const safety = rows.filter((r) => r.kind === 'SAFETY');
  const health = rows.filter((r) => r.kind === 'HEALTH');

  const stats = useMemo(() => {
    const applies = rows.filter((r) => r.answer === 'APPLIES');
    return {
      considered: rows.filter((r) => r.answer !== 'UNANSWERED').length,
      total: rows.length,
      applies: applies.length,
      missingControls: applies.filter((r) => (r.controls ?? '').trim() === '')
        .length,
    };
  }, [rows]);

  async function save(row: RiskTopicRow, next: Partial<RiskTopicRow>) {
    const merged = { ...row, ...next };
    setRows((rs) => rs.map((r) => (r.key === row.key ? merged : r)));
    setBusy(row.key);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/risks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: row.key,
          applicable:
            merged.answer === 'UNANSWERED' ? null : merged.answer === 'APPLIES',
          controls: merged.controls,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save.');
        // Put the row back as it was — an optimistic update that failed must
        // not leave the screen claiming something the database does not hold.
        setRows((rs) => rs.map((r) => (r.key === row.key ? row : r)));
        return;
      }
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
      setRows((rs) => rs.map((r) => (r.key === row.key ? row : r)));
    } finally {
      setBusy(null);
    }
  }

  function Topic({ row }: { row: RiskTopicRow }) {
    const saving = busy === row.key;
    const applies = row.answer === 'APPLIES';
    const needsControls = applies && (row.controls ?? '').trim() === '';
    return (
      <li
        className={`rounded-xl border p-3 ${
          needsControls
            ? 'border-hivis-500/50 bg-hivis-500/5'
            : 'border-line bg-surface'
        }`}
      >
        <p className="text-sm font-semibold text-ink">{row.label}</p>
        {row.hint && <p className="mt-0.5 text-xs text-ink-muted">{row.hint}</p>}

        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ['APPLIES', 'Applies to this site'],
              ['NOT_APPLICABLE', 'Does not apply'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={!canEdit || saving}
              aria-pressed={row.answer === value}
              onClick={() =>
                save(row, {
                  // Pressing the current answer clears it back to unconsidered,
                  // so a decision made in error can be undone rather than only
                  // swapped for the opposite one.
                  answer: row.answer === value ? 'UNANSWERED' : value,
                })
              }
              className={`touch-target rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                row.answer === value
                  ? value === 'APPLIES'
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-ink-subtle bg-surface-sunken text-ink'
                  : 'border-line bg-surface text-ink-muted hover:bg-surface-sunken'
              }`}
            >
              {label}
            </button>
          ))}
          {row.answer === 'UNANSWERED' && (
            <span className="self-center text-xs text-ink-subtle">
              Not yet considered
            </span>
          )}
        </div>

        {applies && (
          <div className="mt-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Control measures
            </label>
            <textarea
              rows={3}
              defaultValue={row.controls ?? ''}
              disabled={!canEdit || saving}
              maxLength={2000}
              placeholder="How is this risk controlled on this site?"
              onBlur={(e) => {
                if ((e.target.value ?? '') !== (row.controls ?? '')) {
                  save(row, { controls: e.target.value });
                }
              }}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:bg-surface-sunken"
            />
            {needsControls && (
              <p className="mt-1 text-xs font-semibold text-ink">
                This topic applies but has no control measures recorded. The plan
                will say so.
              </p>
            )}
          </div>
        )}
      </li>
    );
  }

  function Group({ title, list }: { title: string; list: RiskTopicRow[] }) {
    const common = list.filter((r) => r.commonlyApplicable);
    const rare = list.filter((r) => !r.commonlyApplicable);
    const rareOutstanding = rare.filter((r) => r.answer === 'UNANSWERED').length;
    return (
      <section className="mt-5">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <ul className="mt-2 space-y-2">
          {common.map((r) => (
            <Topic key={r.key} row={r} />
          ))}
        </ul>
        {rare.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowRare((v) => !v)}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              {showRare ? 'Hide' : 'Show'} less common risks ({rare.length})
              {rareOutstanding > 0 && !showRare
                ? ` — ${rareOutstanding} not yet considered`
                : ''}
            </button>
            {showRare && (
              <ul className="mt-2 space-y-2">
                {rare.map((r) => (
                  <Topic key={r.key} row={r} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="text-base font-bold text-ink">
        Significant risks and controls
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        The risk topics a construction phase plan is expected to address (HSE
        L153). Recording that a topic does not apply is an answer — it shows the
        risk was considered, which is what the plan needs to demonstrate.
      </p>

      <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3 text-sm">
        <p className="font-semibold text-ink">
          {stats.considered} of {stats.total} topics considered ·{' '}
          {stats.applies} apply to this site
        </p>
        {stats.missingControls > 0 && (
          <p className="mt-1 text-ink-muted">
            {stats.missingControls} topic
            {stats.missingControls === 1 ? '' : 's'} marked as applying but with
            no control measures recorded.
          </p>
        )}
      </div>

      <Group title="Safety risks" list={safety} />
      <Group title="Health risks" list={health} />
    </div>
  );
}
