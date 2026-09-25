'use client';

/**
 * ONE LIBRARY VIDEO, IN FULL.
 *
 * ── WHY THIS PAGE EXISTS ──────────────────────────────────────────────────
 *
 * The Library was one flat list. A row had to carry the lifecycle, the settings, the
 * revision history and the upload controls at once, so it carried none of them
 * properly: there was no way to watch what you had uploaded, no way to see where a
 * video was used, and the commonest state of all - live, with a replacement being
 * prepared - could only be read by joining up two separate blocks.
 *
 * ── THE RULE THIS SCREEN ENFORCES ─────────────────────────────────────────
 *
 * A GENERATED asset's content is not editable here. It was produced from a Company
 * Module, and the module is the source of truth: an edit belongs there, followed by
 * a regeneration. Two editable copies of "PPE expectations" would drift apart and
 * nobody could say which one an operative had been shown. Library metadata - title,
 * category, placement, whether a site may opt out - stays editable either way,
 * because that is about where the video is used and not about what it says.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// Values from modules with no Prisma in them - see libraryLimits.ts for why that
// matters in a client component.
import { LIBRARY_CATEGORIES, categoryLabel, provenanceLabel, provenanceHint, contentEditableHere }
  from '@/services/inductionVideo/libraryTaxonomy';
import { MAX_LIBRARY_VIDEO_BYTES, describeBytes } from '@/services/inductionVideo/libraryLimits';
import type { LibraryAssetDetail as Detail } from '@/services/inductionVideo/libraryDetail';

const PLACEMENT_LABEL: Record<string, string> = {
  OPENING: 'Plays at the very start, before the site welcome',
  COMPANY_BAND: 'Plays after the site information, before the site rules',
  CLOSING: 'Plays at the end, before sign-off',
};

const TONE: Record<string, string> = {
  good: 'bg-safe-50 text-safe-700 border-safe-200',
  working: 'bg-hivis-50 text-hivis-700 border-hivis-200',
  attention: 'bg-hivis-50 text-hivis-700 border-hivis-200',
  bad: 'bg-danger-50 text-danger-700 border-danger-200',
  neutral: 'bg-surface-sunken text-ink-muted border-line',
};

export function LibraryAssetDetail({
  asset,
  modules,
  canDraft,
  canIssue,
  endpoint,
  backHref,
}: {
  asset: Detail;
  modules: { id: string; title: string }[];
  canDraft: boolean;
  canIssue: boolean;
  endpoint: string;
  backHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ revisionId: string; url: string } | null>(null);
  const [issueNote, setIssueNote] = useState('');

  const editableContent = contentEditableHere(asset.provenance);

  async function call(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? 'That could not be saved.');
        return null;
      }
      router.refresh();
      return json ?? {};
    } finally {
      setBusy(null);
    }
  }

  async function watch(revisionId: string) {
    setError(null);
    setBusy(`play-${revisionId}`);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'previewUrl', revisionId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) {
        setError(json?.error ?? 'That video could not be opened.');
        return;
      }
      setPlaying({ revisionId, url: json.url as string });
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: 'VIDEO' | 'CAPTIONS', file: File) {
    setError(null);
    if (kind === 'VIDEO' && file.size > MAX_LIBRARY_VIDEO_BYTES) {
      setError(
        `That file is ${describeBytes(file.size)}. The limit is ` +
          `${describeBytes(MAX_LIBRARY_VIDEO_BYTES)} — export it at a lower bitrate, ` +
          'or split it into shorter videos.',
      );
      return;
    }
    setBusy(`upload-${kind}`);
    setProgress(`Preparing to upload ${file.name}…`);
    try {
      let revisionId = asset.draftId;
      if (!revisionId) {
        const started = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'startRevision', assetId: asset.id }),
        }).then((r) => r.json().catch(() => ({})));
        if (!started?.revisionId) {
          setError(started?.error ?? 'Could not open a new revision.');
          return;
        }
        revisionId = started.revisionId as string;
      }
      const ticket = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'uploadUrl', revisionId, kind, fileName: file.name }),
      }).then((r) => r.json().catch(() => ({})));
      if (!ticket?.url) {
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
      setProgress(kind === 'VIDEO' ? 'Preparing the video…' : 'Saved.');
      await call(
        {
          action: 'attach',
          revisionId,
          kind,
          blobPath: ticket.blobPath,
          fileName: file.name,
          bytes: file.size,
        },
        `attach-${kind}`,
      );
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const s = asset.status;

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-xs font-semibold text-brand-700 hover:underline">
        ← All library videos
      </Link>

      {/* ── WHAT THIS IS, AND WHETHER IT REACHES ANYBODY ── */}
      <header className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink">{asset.title}</h2>
            <p className="mt-0.5 text-xs text-ink-subtle">
              {asset.slug} · {categoryLabel(asset.category)} · {provenanceLabel(asset.provenance)}
            </p>
          </div>
          <span
            className={`ml-auto rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE[s.tone]}`}
          >
            {s.label}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-muted">{s.detail}</p>
        {asset.description && <p className="mt-2 text-sm text-ink">{asset.description}</p>}

        {!editableContent && (
          <p className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
            <span className="font-semibold">This video was generated from a Company Module.</span>{' '}
            {provenanceHint(asset.provenance)}
            {asset.moduleId && (
              <>
                {' '}
                <Link
                  href={`${backHref.replace(/\/library$/, '')}/modules`}
                  className="font-semibold underline"
                >
                  Edit “{asset.moduleTitle}”
                </Link>{' '}
                and regenerate.
              </>
            )}
          </p>
        )}
      </header>

      {error && (
        <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}
      {progress && (
        <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {progress}
        </p>
      )}

      {/* ── WHERE IT IS USED. Every figure here was already in the database and
             nothing had ever shown it. ── */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-sm font-bold text-ink">Where this video is used</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-subtle">Projects including it</dt>
            <dd className="text-lg font-bold text-ink">
              {asset.usage.onProjects}
              <span className="text-sm font-normal text-ink-subtle"> of {asset.usage.totalProjects}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Published inductions containing it</dt>
            <dd className="text-lg font-bold text-ink">{asset.usage.publishedTotal}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Revisions</dt>
            <dd className="text-lg font-bold text-ink">{asset.revisions.length}</dd>
          </div>
        </dl>
        {asset.usage.switchedOffBy.length > 0 && (
          <p className="mt-3 text-xs text-ink-muted">
            <span className="font-semibold">Switched off by:</span>{' '}
            {asset.usage.switchedOffBy.map((x) => x.siteName).join(', ')}
          </p>
        )}
        {asset.mandatory && (
          <p className="mt-3 text-xs text-ink-muted">
            This video is mandatory, so no project may leave it out.
          </p>
        )}
      </section>

      {/* ── WHERE IT PLAYS, shown as the running order rather than as a label. ── */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-sm font-bold text-ink">Where it plays</h3>
        <p className="mt-1 text-xs text-ink-muted">{PLACEMENT_LABEL[asset.placement] ?? asset.placement}</p>
        <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          {asset.band.map((b) => (
            <li
              key={b.id}
              className={`rounded-full border px-2 py-0.5 ${
                b.id === asset.id
                  ? 'border-brand-300 bg-brand-50 font-semibold text-brand-800'
                  : b.active
                    ? 'border-line bg-surface-sunken text-ink-muted'
                    : 'border-line bg-surface-sunken text-ink-subtle line-through'
              }`}
            >
              {b.title}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-subtle">
          The order videos play within this part of the induction. Retired videos are struck
          through.
        </p>
      </section>

      {/* ── SETTINGS. Editable for both provenances: this is about where the video is
             used, not about what it says. ── */}
      {canIssue && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h3 className="text-sm font-bold text-ink">Settings</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink">
              Category
              <select
                defaultValue={asset.category}
                onChange={(e) =>
                  void call({ action: 'settings', assetId: asset.id, category: e.target.value },
                    'category')
                }
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
              >
                {LIBRARY_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-ink">
              Stands in for the company module
              <select
                defaultValue={asset.moduleId ?? ''}
                onChange={(e) =>
                  void call({ action: 'settings', assetId: asset.id, moduleId: e.target.value },
                    'module')
                }
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal"
              >
                <option value="">Nothing — it plays alongside the modules</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
              <span className="mt-1 block font-normal text-ink-subtle">
                Where this is set, the written module is left out so an operative is not told the
                same thing twice.
              </span>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2 font-semibold text-ink">
              <input
                type="checkbox"
                defaultChecked={asset.mandatory}
                onChange={(e) =>
                  void call({ action: 'settings', assetId: asset.id, mandatory: e.target.checked },
                    'mandatory')
                }
              />
              Every project must include it
            </label>
            <label className="flex items-center gap-2 font-semibold text-ink">
              <input
                type="checkbox"
                defaultChecked={asset.defaultIncluded}
                disabled={asset.mandatory}
                onChange={(e) =>
                  void call(
                    { action: 'settings', assetId: asset.id, defaultIncluded: e.target.checked },
                    'default')
                }
              />
              On by default for new projects
            </label>
          </div>
        </section>
      )}

      {/* ── FOOTAGE. Only for an uploaded asset: a generated one takes its content
             from the module. ── */}
      {canDraft && editableContent && asset.active && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h3 className="text-sm font-bold text-ink">
            {asset.draftId ? `Revision in progress` : 'Start a new revision'}
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            A revision needs a video file <span className="font-semibold">and</span> a WebVTT
            caption file before it can be issued. Up to{' '}
            {describeBytes(MAX_LIBRARY_VIDEO_BYTES)}, portrait 9:16 for best results — landscape
            footage is letterboxed rather than cropped.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink">
              Video file
              <input
                type="file"
                accept="video/*"
                disabled={busy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload('VIDEO', f);
                  e.target.value = '';
                }}
                className="mt-1 block w-full text-xs font-normal"
              />
            </label>
            <label className="text-xs font-semibold text-ink">
              Caption file (.vtt)
              <input
                type="file"
                accept=".vtt,text/vtt"
                disabled={busy !== null || !asset.draftId}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload('CAPTIONS', f);
                  e.target.value = '';
                }}
                className="mt-1 block w-full text-xs font-normal"
              />
              {!asset.draftId && (
                <span className="mt-1 block font-normal text-ink-subtle">
                  Upload the video first.
                </span>
              )}
            </label>
          </div>
        </section>
      )}

      {/* ── REVISIONS: the history, each one watchable. ── */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-sm font-bold text-ink">Revisions</h3>
        {asset.revisions.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            Nothing yet. This video reaches nobody until a revision is issued.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {asset.revisions.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surface-sunken p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-bold text-ink">Revision {r.version}</span>
                  <span className="text-xs font-semibold text-ink-muted">
                    {r.status === 'ISSUED' && !r.supersededOn
                      ? 'In force'
                      : r.status === 'DRAFT'
                        ? 'Draft'
                        : r.supersededOn
                          ? `Superseded ${r.supersededOn}`
                          : r.status}
                  </span>
                  {r.durationLabel && (
                    <span className="text-xs text-ink-subtle">{r.durationLabel}</span>
                  )}
                  {r.playable && (
                    <button
                      type="button"
                      onClick={() => void watch(r.id)}
                      disabled={busy !== null}
                      className="ml-auto rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-sunken disabled:opacity-50"
                    >
                      {busy === `play-${r.id}` ? 'Opening…' : 'Watch'}
                    </button>
                  )}
                </div>

                {playing?.revisionId === r.id && (
                  <video
                    src={playing.url}
                    controls
                    playsInline
                    className="mt-2 max-h-[70vh] w-full rounded-lg bg-black"
                  />
                )}

                <p className="mt-2 text-xs text-ink-subtle">
                  Prepared by {r.preparedByName}
                  {r.preparedByRealm ? ` (${r.preparedByRealm})` : ''} on {r.preparedOn}
                  {r.issuedOn && (
                    <>
                      {' · issued by '}
                      {r.issuedByName}
                      {r.issuedByRealm ? ` (${r.issuedByRealm})` : ''} on {r.issuedOn}
                    </>
                  )}
                </p>
                {r.issueNote && <p className="mt-1 text-xs text-ink-muted">“{r.issueNote}”</p>}
                {r.normaliseError && (
                  <p className="mt-1 text-xs font-medium text-danger-700">{r.normaliseError}</p>
                )}
                {r.status === 'DRAFT' && r.missing.length > 0 && (
                  <p className="mt-1 text-xs text-hivis-700">
                    Still needs {r.missing.join(' and ')}.
                  </p>
                )}
                {(r.usage.publishedInductions > 0 || r.usage.unpublishedInductions > 0) && (
                  <p className="mt-1 text-xs text-ink-muted">
                    In {r.usage.publishedInductions} published
                    {r.usage.unpublishedInductions > 0
                      ? ` and ${r.usage.unpublishedInductions} unpublished`
                      : ''}{' '}
                    induction{r.usage.publishedInductions + r.usage.unpublishedInductions === 1 ? '' : 's'}
                    {r.usage.projects > 0 ? ` across ${r.usage.projects} project${r.usage.projects === 1 ? '' : 's'}` : ''}.
                  </p>
                )}

                {r.status === 'DRAFT' && r.ready && canIssue && (
                  <div className="mt-3 rounded-lg border border-line bg-surface p-3">
                    <p className="text-xs text-ink-muted">{asset.issueConsequence}</p>
                    <input
                      value={issueNote}
                      onChange={(e) => setIssueNote(e.target.value)}
                      placeholder="What changed in this revision?"
                      className="mt-2 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      disabled={busy !== null || issueNote.trim().length < 3}
                      onClick={() =>
                        void call({ action: 'issue', revisionId: r.id, issueNote }, 'issue')
                      }
                      className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {busy === 'issue' ? 'Issuing…' : `Issue revision ${r.version}`}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── RETIRE / BRING BACK, with the consequence said first. ── */}
      {canIssue && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h3 className="text-sm font-bold text-ink">
            {asset.active ? 'Retire this video' : 'Bring this video back'}
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            {asset.active
              ? asset.retireConsequence
              : 'It will be available to projects again from their next generation onwards.'}
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void call({ action: 'setActive', assetId: asset.id, active: !asset.active }, 'active')
            }
            className="mt-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-sunken disabled:opacity-50"
          >
            {busy === 'active' ? 'Saving…' : asset.active ? 'Retire' : 'Bring back'}
          </button>
        </section>
      )}
    </div>
  );
}
