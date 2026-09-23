'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SiteCompanyRowView {
  id: string;
  name: string;
  operatives: number;
  documents: number;
  removable: boolean;
}

/**
 * The companies working on one project.
 *
 * WHY A LIST AND NOT A TEXT BOX. Company used to be typed on every invitation,
 * which is how one roster ends up holding "RS Electrical", "RS Elec - Test",
 * "test" and "Test". None of that can decide whose RAMS an operative sees, so a
 * company is now a record: chosen when inviting, and attached to the documents
 * that company brings.
 *
 * MERGING IS DELIBERATE. Two spellings may be one firm or two, and only someone
 * on the project knows. Nothing here merges on a resemblance; a manager picks
 * both sides and confirms, and the operatives and documents move together.
 */
export function SiteCompaniesManager({
  siteId,
  companies,
}: {
  siteId: string;
  companies: SiteCompanyRowView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [merging, setMerging] = useState<{ fromId: string; intoId: string } | null>(null);

  async function call(body: Record<string, unknown>, done?: (data: Record<string, unknown>) => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/platform/sites/${siteId}/companies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return;
      }
      done?.(data);
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink';
  const smallButton =
    'rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-40';

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink">Companies on this project</h3>
        <p className="text-xs text-ink-muted">
          Operatives are invited into one of these, and a document can belong to
          one of them. An operative sees their own company’s documents and
          anything that applies to everyone.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}
      {note && (
        <p className="rounded-lg border border-safe-500/40 bg-safe-50 px-3 py-2 text-sm text-safe-700">
          {note}
        </p>
      )}

      {companies.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No companies yet. Add the first one below, or add one while inviting an
          operative.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {companies.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              {renaming?.id === c.id ? (
                <>
                  <input
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                    className={`${input} max-w-xs`}
                    aria-label={`New name for ${c.name}`}
                  />
                  <button
                    type="button"
                    className={smallButton}
                    disabled={busy || renaming.name.trim().length < 2}
                    onClick={() =>
                      call({ action: 'rename', id: c.id, name: renaming.name }, () =>
                        setRenaming(null),
                      )
                    }
                  >
                    Save
                  </button>
                  <button type="button" className={smallButton} onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-xs text-ink-muted">
                    {c.operatives} operative{c.operatives === 1 ? '' : 's'} ·{' '}
                    {c.documents} document{c.documents === 1 ? '' : 's'}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      className={smallButton}
                      onClick={() => setRenaming({ id: c.id, name: c.name })}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className={smallButton}
                      onClick={() =>
                        setMerging({ fromId: c.id, intoId: '' })
                      }
                    >
                      Merge
                    </button>
                    {/* Removable only when nothing points at it: deleting a
                        company with documents would orphan them, and with
                        operatives would change what they can see. */}
                    <button
                      type="button"
                      className={smallButton}
                      disabled={!c.removable || busy}
                      title={
                        c.removable
                          ? undefined
                          : 'Move or merge its operatives and documents first'
                      }
                      onClick={() => call({ action: 'remove', id: c.id })}
                    >
                      Remove
                    </button>
                  </span>
                </>
              )}

              {merging?.fromId === c.id && (
                <div className="mt-2 flex w-full flex-wrap items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2">
                  <span className="text-xs text-ink-muted">
                    Move everything from <b>{c.name}</b> into
                  </span>
                  <select
                    value={merging.intoId}
                    onChange={(e) => setMerging({ fromId: c.id, intoId: e.target.value })}
                    className={`${input} max-w-xs`}
                    aria-label={`Company to merge ${c.name} into`}
                  >
                    <option value="">Choose a company…</option>
                    {companies
                      .filter((o) => o.id !== c.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={!merging.intoId || busy}
                    onClick={() =>
                      call(
                        { action: 'merge', fromId: c.id, intoId: merging.intoId },
                        (data) => {
                          const m = data.merged as {
                            operatives: number;
                            documents: number;
                            into: string;
                          };
                          setNote(
                            `Moved ${m.operatives} operative${m.operatives === 1 ? '' : 's'} and ${m.documents} document${m.documents === 1 ? '' : 's'} into ${m.into}.`,
                          );
                          setMerging(null);
                        },
                      )
                    }
                  >
                    Merge
                  </button>
                  <button type="button" className={smallButton} onClick={() => setMerging(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Add a company"
          aria-label="Add a company to this project"
          className={`${input} max-w-xs`}
        />
        <button
          type="button"
          className="rounded-lg bg-safe-500 px-3 py-2 text-sm font-semibold text-white hover:bg-safe-600 disabled:opacity-40"
          disabled={adding.trim().length < 2 || busy}
          onClick={() => call({ action: 'add', name: adding }, () => setAdding(''))}
        >
          {busy ? 'Working…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
