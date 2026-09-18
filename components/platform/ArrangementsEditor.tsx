'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { CPP_ARRANGEMENTS } from '@/services/sites/cppArrangements';

/**
 * CPP Tier 3A — the management arrangements editor.
 *
 * ONE COMPONENT FOR BOTH LEVELS. Company and site editing differ only in whether
 * there is something to inherit from, and two components would drift in wording
 * the moment either changed. `standardContent` being present is what makes this
 * the site editor.
 *
 * Imports the CATALOGUE, which is pure, and never the service, which reaches
 * lib/prisma — a value import from a client component fails the webpack build
 * while tsc stays green.
 */

export interface ArrangementRow {
  key: string;
  content: string | null;
  /** Site editor only: the company text this would override. */
  standardContent?: string | null;
  source?: 'SITE' | 'STANDARD' | 'NONE';
}

export function ArrangementsEditor({
  endpoint,
  initial,
  canEdit,
  level,
}: {
  /** Where a save is PUT. Company or site — the shapes are identical. */
  endpoint: string;
  initial: ArrangementRow[];
  canEdit: boolean;
  level: 'COMPANY' | 'SITE';
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<ArrangementRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function save(key: string, content: string | null) {
    setBusy(key);
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, content }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        arrangements?: ArrangementRow[] | Record<string, string | null>;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not save.');
        return;
      }
      // The server returns the resolved state, which is the only thing that
      // knows whether a site row now counts as an override.
      if (Array.isArray(data.arrangements)) setRows(data.arrangements);
      else if (data.arrangements) {
        const map = data.arrangements as Record<string, string | null>;
        setRows((rs) => rs.map((r) => ({ ...r, content: map[r.key] ?? null })));
      }
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      toast.success(content === null ? 'Removed.' : 'Saved.');
      router.refresh();
    } catch {
      toast.error('Network problem. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {CPP_ARRANGEMENTS.map((meta) => {
        const row = rows.find((r) => r.key === meta.key);
        const saving = busy === meta.key;
        const isSite = level === 'SITE';
        const overriding = isSite && row?.source === 'SITE';
        // On the site editor the box holds the OVERRIDE, not the inherited text —
        // pre-filling it with the company standard would turn "read the default"
        // into "silently copy it", and every site would end up with a frozen copy
        // that no longer tracks company policy.
        const stored = isSite
          ? overriding
            ? (row?.content ?? '')
            : ''
          : (row?.content ?? '');
        const value = drafts[meta.key] ?? stored;
        const dirty = drafts[meta.key] !== undefined && drafts[meta.key] !== stored;

        return (
          <section
            key={meta.key}
            className="rounded-xl border border-line bg-surface p-4 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink">{meta.title}</h3>
                <p className="mt-0.5 text-xs text-ink-muted">{meta.purpose}</p>
              </div>
              {isSite && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                    overriding
                      ? 'bg-brand-50 text-brand-700'
                      : row?.source === 'STANDARD'
                        ? 'bg-surface-sunken text-ink-muted'
                        : 'bg-hivis-500/15 text-ink'
                  }`}
                >
                  {overriding
                    ? 'Site-specific'
                    : row?.source === 'STANDARD'
                      ? 'Company standard'
                      : 'Not recorded'}
                </span>
              )}
            </div>

            <p className="mt-2 rounded-lg bg-surface-sunken p-2 text-xs text-ink-muted">
              {meta.guidance}
            </p>

            {/* The inherited text, shown read-only so a site manager can see what
                they would be replacing before they replace it. */}
            {isSite && !overriding && (
              <div className="mt-2">
                {row?.standardContent ? (
                  <p className="whitespace-pre-line rounded-lg border border-line p-3 text-sm text-ink">
                    {row.standardContent}
                  </p>
                ) : (
                  <p className="rounded-lg border border-hivis-500/40 bg-hivis-500/10 p-3 text-sm text-ink">
                    No company standard has been written for this arrangement, and
                    this site has not written its own. The plan will say it is not
                    recorded.
                  </p>
                )}
                {meta.promptSiteSpecific && (
                  <p className="mt-1 text-xs text-ink-muted">
                    This arrangement usually differs by project — consider writing
                    a site-specific version.
                  </p>
                )}
              </div>
            )}

            <textarea
              rows={overriding || !isSite ? 6 : 3}
              value={value}
              disabled={!canEdit || saving}
              maxLength={8000}
              placeholder={
                isSite
                  ? 'Write a site-specific version, or leave blank to use the company standard.'
                  : 'Write the company standard for this arrangement.'
              }
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [meta.key]: e.target.value }))
              }
              className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:bg-surface-sunken"
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canEdit || saving || !dirty}
                onClick={() => save(meta.key, value.trim() === '' ? null : value)}
                className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {((isSite && overriding) || (!isSite && (row?.content ?? '') !== '')) && (
                <button
                  type="button"
                  disabled={!canEdit || saving}
                  onClick={() => save(meta.key, null)}
                  className="text-sm font-medium text-ink-subtle hover:underline disabled:opacity-50"
                >
                  {isSite ? 'Use the company standard' : 'Clear this arrangement'}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
