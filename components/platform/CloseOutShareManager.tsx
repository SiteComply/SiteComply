'use client';

import { useCallback, useEffect, useState } from 'react';

interface ShareRow {
  id: string;
  label: string;
  includeZip: boolean;
  expiresAt: string;
  revokedAt: string | null;
  createdByName: string;
  createdAt: string;
  viewCount: number;
  lastViewedAt: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

const EXPIRY_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const STATUS_STYLE: Record<ShareRow['status'], string> = {
  ACTIVE: 'bg-brand-700/10 text-brand-700',
  EXPIRED: 'bg-ink-subtle/10 text-ink-subtle',
  REVOKED: 'bg-danger-50 text-danger-600',
};

/**
 * SC-024 Phase 3 — create, view and revoke share links for a pack revision.
 *
 * The generated URL is shown ONCE. Only its hash is stored, so it genuinely
 * cannot be retrieved again — the panel says so rather than letting someone
 * assume they can come back for it later.
 */
export function CloseOutShareManager({
  siteId,
  packId,
  hasZip,
}: {
  siteId: string;
  packId: string;
  hasZip: boolean;
}) {
  const base = `/api/platform/sites/${siteId}/close-out/${packId}/shares`;

  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareRow[] | null>(null);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(30);
  const [includeZip, setIncludeZip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setShares(data.shares as ShareRow[]);
    } catch {
      /* the list is a convenience; a failed load must not block creating one */
    }
  }, [base]);

  useEffect(() => {
    if (open && shares === null) void load();
  }, [open, shares, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssued(null);
    setCopied(false);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, days, includeZip }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not create the link.');
        return;
      }
      setIssued({ url: data.url, expiresAt: data.expiresAt });
      setLabel('');
      setShares(null);
      void load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError('Could not revoke that link.');
        return;
      }
      setShares(null);
      void load();
    } catch {
      setError('Could not reach the server.');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
      >
        Share…
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink">Secure sharing</h3>
          <p className="text-xs text-ink-muted">
            Creates an expiring link for a client or Principal Contractor. The
            recipient does not need an account, and the pack shows only what you
            can see.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-semibold text-ink-subtle"
        >
          Close
        </button>
      </div>

      <form onSubmit={create} className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-ink">
            Who is this for?
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Acme Developments"
            maxLength={120}
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-ink">
            Expires after
          </span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy || label.trim() === ''}
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create link'}
          </button>
        </div>

        {hasZip ? (
          <label className="flex items-center gap-2 text-xs text-ink-muted sm:col-span-4">
            <input
              type="checkbox"
              checked={includeZip}
              onChange={(e) => setIncludeZip(e.target.checked)}
            />
            Also let them download the ZIP of every original file
          </label>
        ) : null}
      </form>

      {issued ? (
        <div className="mt-3 rounded-lg border border-brand-700/30 bg-brand-700/5 p-3">
          <p className="text-xs font-semibold text-ink">
            Copy this link now — it cannot be shown again.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-line bg-surface px-2 py-1 text-xs text-ink">
              {issued.url}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(issued.url);
                setCopied(true);
              }}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-subtle">
            Expires {new Date(issued.expiresAt).toLocaleDateString('en-GB')}.
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-danger-600">{error}</p> : null}

      {shares && shares.length > 0 ? (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {shares.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-xs font-semibold text-ink">
                  {s.label}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[s.status]}`}
                  >
                    {s.status.toLowerCase()}
                  </span>
                  {s.includeZip ? (
                    <span className="text-[10px] font-medium text-ink-subtle">
                      incl. ZIP
                    </span>
                  ) : null}
                </p>
                <p className="text-[11px] text-ink-subtle">
                  by {s.createdByName} · expires{' '}
                  {new Date(s.expiresAt).toLocaleDateString('en-GB')} ·{' '}
                  {s.viewCount === 0
                    ? 'not opened yet'
                    : `opened ${s.viewCount} time${s.viewCount === 1 ? '' : 's'}`}
                  {s.lastViewedAt
                    ? `, last ${new Date(s.lastViewedAt).toLocaleDateString('en-GB')}`
                    : ''}
                </p>
              </div>
              {s.status === 'ACTIVE' ? (
                <button
                  type="button"
                  onClick={() => revoke(s.id)}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink"
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
