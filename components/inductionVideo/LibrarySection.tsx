'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface LibraryRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  placement: string;
  mandatory: boolean;
  defaultIncluded: boolean;
  active: boolean;
  moduleTitle: string | null;
  issued: {
    version: number;
    issuedOn: string;
    issuedByName: string | null;
    issuedByRealm: string | null;
    durationLabel: string | null;
  } | null;
  draft: {
    id: string;
    version: number;
    preparedByName: string;
    ready: boolean;
    missing: string[];
    normaliseError: string | null;
  } | null;
  revisionCount: number;
}

const PLACEMENT_LABEL: Record<string, string> = {
  OPENING: 'Opens the induction',
  COMPANY_BAND: 'With the company standards',
  CLOSING: 'Before the close',
};

/**
 * The video Library.
 *
 * ── THE STATE THAT MATTERS IS "IS IT ISSUED" ──────────────────────────────
 *
 * Same as company modules, for the same reason: an asset with no issued revision
 * reaches nobody, however good the footage. So it is the first thing each row says.
 *
 * ── AND THEN "IS IT READY TO ISSUE" ───────────────────────────────────────
 *
 * Unlike a module, a draft here is not ready the moment it is written. The upload
 * has to be transcoded to the render pipeline's exact spec before it can be joined
 * to anything, and it needs a caption file. So a draft says what it is still
 * waiting for, rather than offering an Issue button that would be refused.
 *
 * ── UPLOADS GO STRAIGHT TO STORAGE ────────────────────────────────────────
 *
 * The file never passes through the application. This asks the server for a
 * short-lived upload URL, PUTs the bytes to it, and then tells the server where
 * they landed. A hundred-megabyte video through a route on a small instance fails
 * for reasons nobody can act on.
 */
export function LibrarySection({
  assets,
  modules,
  canDraft,
  canIssue,
  endpoint,
}: {
  assets: LibraryRow[];
  /** Company modules a video can stand in for. */
  modules: { id: string; title: string }[];
  canDraft: boolean;
  canIssue: boolean;
  /** This tier's library API. */
  endpoint: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    slug: '',
    title: '',
    description: '',
    placement: 'COMPANY_BAND',
    moduleId: '',
  });
  const [issuing, setIssuing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<string | null>(null);

  async function call(body: Record<string, unknown>, key: string) {
    if (busy) return null;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'That did not work.');
        return null;
      }
      router.refresh();
      return data as Record<string, unknown>;
    } catch {
      setError('Network problem. Please try again.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Ask for a URL, PUT the bytes, tell the server where they went.
   *
   * The three steps are separate on purpose: if the upload fails the revision is
   * untouched, and if the recording call fails the blob is simply unreferenced
   * rather than half-attached.
   */
  async function upload(
    assetId: string,
    revisionId: string | null,
    kind: 'VIDEO' | 'CAPTIONS',
    file: File,
  ) {
    setError(null);
    setProgress(`Preparing to upload ${file.name}…`);
    try {
      let rev = revisionId;
      if (!rev) {
        const started = await call({ action: 'startRevision', assetId }, `rev-${assetId}`);
        if (!started) return;
        rev = started.revisionId as string;
      }
      const ticket = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'uploadUrl',
          revisionId: rev,
          kind,
          fileName: file.name,
        }),
      }).then((r) => r.json());
      if (!ticket?.ok) {
        setError(ticket?.error ?? 'Could not start the upload.');
        return;
      }

      setProgress(`Uploading ${file.name}…`);
      const put = await fetch(ticket.url as string, {
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'content-type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      if (!put.ok) {
        setError(`The upload failed (${put.status}). Please try again.`);
        return;
      }

      setProgress(
        kind === 'VIDEO' ? 'Preparing the video for the induction pipeline…' : 'Saved.',
      );
      await call(
        {
          action: 'attach',
          revisionId: rev,
          kind,
          blobPath: ticket.blobPath,
          fileName: file.name,
          bytes: file.size,
        },
        `attach-${rev}`,
      );
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">Company video library</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Approved footage, filmed once and included in every project’s induction
          alongside the scenes generated from that site’s own records. A video only
          reaches an induction once it has been <strong>issued</strong>, and an
          upload is prepared to the induction format before it can be.
        </p>
        {canDraft && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Add a library video
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}
      {progress && (
        <p role="status" aria-live="polite" className="rounded-lg border border-brand-500/40 bg-brand-50 px-3 py-2 text-sm text-ink">
          {progress}
        </p>
      )}

      {adding && (
        <div className="space-y-2 rounded-xl border border-line bg-surface-sunken p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink">
              Title
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
              />
            </label>
            <label className="text-xs font-semibold text-ink">
              Reference
              <input
                value={draft.slug}
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                placeholder="COMPANY_INTRO"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-ink">
            What it covers
            <input
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink">
              Where it plays
              <select
                value={draft.placement}
                onChange={(e) => setDraft((d) => ({ ...d, placement: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
              >
                <option value="OPENING">Opens the induction</option>
                <option value="COMPANY_BAND">With the company standards</option>
                <option value="CLOSING">Before the close</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-ink">
              Replaces a written module
              <select
                value={draft.moduleId}
                onChange={(e) => setDraft((d) => ({ ...d, moduleId: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
              >
                <option value="">Nothing — it stands on its own</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-ink-subtle">
            Choosing a module means an operative sees this film{' '}
            <strong>instead of</strong> hearing that module read aloud — the same
            content, delivered better, and never both.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || draft.title.trim().length < 3 || draft.slug.trim().length < 3}
              onClick={async () => {
                const r = await call({ action: 'create', ...draft }, 'create');
                if (r) {
                  setAdding(false);
                  setDraft({ slug: '', title: '', description: '', placement: 'COMPANY_BAND', moduleId: '' });
                }
              }}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy === 'create' ? 'Adding…' : 'Add it'}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {assets.length === 0 && !adding && (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">
          No library videos yet. Every project’s induction is currently built
          entirely from generated scenes and written company modules.
        </p>
      )}

      {assets.map((a) => (
        <article key={a.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-bold text-ink">{a.title}</h3>
            {a.mandatory ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                Every site
              </span>
            ) : (
              <span className="text-xs text-ink-subtle">
                {a.defaultIncluded ? 'On by default' : 'Off by default'}
              </span>
            )}
            {!a.active && (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-subtle">
                Retired
              </span>
            )}
            <span className="ml-auto text-xs">
              {a.issued ? (
                <span className="font-semibold text-safe-700">
                  Issued · revision {a.issued.version}
                  {a.issued.durationLabel ? ` · ${a.issued.durationLabel}` : ''}
                </span>
              ) : (
                <span className="font-semibold text-hivis-600">
                  Not issued — reaches nobody
                </span>
              )}
            </span>
          </div>

          {a.description && <p className="mt-1 text-sm text-ink-muted">{a.description}</p>}

          <p className="mt-2 text-xs text-ink-subtle">
            {PLACEMENT_LABEL[a.placement] ?? a.placement}
            {a.moduleTitle ? ` · shown instead of “${a.moduleTitle}”` : ''}
            {a.issued
              ? ` · in force since ${a.issued.issuedOn}${
                  a.issued.issuedByName ? ` · issued by ${a.issued.issuedByName}` : ''
                }${a.issued.issuedByRealm ? ` (${a.issued.issuedByRealm})` : ''}`
              : ''}
            {a.revisionCount > 1 ? ` · ${a.revisionCount} revisions` : ''}
          </p>

          {a.draft && (
            <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
              <p className="text-xs font-semibold text-ink">
                Draft revision {a.draft.version} · prepared by {a.draft.preparedByName}
              </p>
              {a.draft.normaliseError ? (
                <p className="mt-1 text-xs font-medium text-danger-700">
                  The upload could not be prepared: {a.draft.normaliseError}
                </p>
              ) : a.draft.ready ? (
                <p className="mt-1 text-xs text-safe-700">
                  Ready to issue.
                </p>
              ) : (
                <p className="mt-1 text-xs text-hivis-600">
                  Still needs {a.draft.missing.join(' and ')}.
                </p>
              )}
              {canDraft && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="text-xs font-semibold text-brand-700">
                    Upload video
                    <input
                      type="file"
                      accept="video/*"
                      className="ml-2 text-xs font-normal text-ink-muted"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload(a.id, a.draft!.id, 'VIDEO', f);
                      }}
                    />
                  </label>
                  <label className="text-xs font-semibold text-brand-700">
                    Upload captions (.vtt)
                    <input
                      type="file"
                      accept=".vtt,text/vtt"
                      className="ml-2 text-xs font-normal text-ink-muted"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload(a.id, a.draft!.id, 'CAPTIONS', f);
                      }}
                    />
                  </label>
                </div>
              )}
              {canIssue && a.draft.ready && (
                <div className="mt-3">
                  {issuing === a.draft.id ? (
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-ink">
                        What changed in this revision? Kept on the history.
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={note.trim().length < 5 || busy !== null}
                          onClick={async () => {
                            const r = await call(
                              { action: 'issue', revisionId: a.draft!.id, issueNote: note },
                              `issue-${a.id}`,
                            );
                            if (r) {
                              setIssuing(null);
                              setNote('');
                            }
                          }}
                          className="rounded-lg bg-safe-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          {busy === `issue-${a.id}` ? 'Issuing…' : 'Issue it'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIssuing(null)}
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                        >
                          Not yet
                        </button>
                      </div>
                      <p className="text-xs text-ink-subtle">
                        Every project’s induction will carry this footage from now
                        on. Existing videos keep the revision they were built with
                        and show as out of date.
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIssuing(a.draft!.id)}
                      className="rounded-lg bg-safe-500 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Issue revision {a.draft.version}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {canDraft && !a.draft && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => call({ action: 'startRevision', assetId: a.id }, `rev-${a.id}`)}
              className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              {busy === `rev-${a.id}` ? 'Starting…' : 'Replace the footage'}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
