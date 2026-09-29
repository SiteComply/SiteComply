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
// Imports nothing but `cn`, so bundling it into this client component is safe - and
// reusing it keeps one set of status words rather than a second, quieter copy.
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
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
  videoHrefBase,
}: {
  asset: Detail;
  modules: {
    id: string;
    title: string;
    /** Without issued wording nothing can be produced from it. */
    hasIssued: boolean;
  }[];
  canDraft: boolean;
  canIssue: boolean;
  endpoint: string;
  backHref: string;
  /** This tier's induction-video working surface, e.g. /platform/dashboard/induction-videos. */
  videoHrefBase: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ revisionId: string; url: string } | null>(null);
  const [issueNote, setIssueNote] = useState('');

  const editableContent = contentEditableHere(asset.provenance);
  const underWay = asset.productions;
  // Producing reads the module's ISSUED wording, so an unissued source is a wall the
  // button should not walk into.
  const sourceModuleReady = Boolean(
    asset.moduleId && modules.find((m) => m.id === asset.moduleId)?.hasIssued,
  );

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
                {/*
                  * Unissued modules are LISTED AND MARKED rather than hidden. For a
                  * generated asset this picker chooses the source of the wording, and
                  * an absent module reads as "that topic does not exist" when the
                  * truth is "somebody still has to issue it".
                  */}
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}{m.hasIssued ? '' : '  — not issued yet'}
                  </option>
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

      {/* ── UNDER WAY. A company video being produced for this asset.
             Before this existed the refusal "version N is already being produced"
             named something no screen rendered, so the asset could be wedged with
             no way to see, finish or discard the production holding it. ── */}
      {underWay.length > 0 && (
        <section className="rounded-xl border border-hivis-200 bg-hivis-50/50 p-4 shadow-card">
          <h3 className="text-sm font-bold text-ink">Under way</h3>
          <p className="mt-1 text-xs text-ink-muted">
            {underWay.length === 1 ? 'A video is' : `${underWay.length} videos are`} being produced
            for this library video. Only one production runs at a time, so this has to be finished
            or discarded before another can start.
          </p>
          <ul className="mt-3 space-y-3">
            {underWay.map((p) => (
              <li key={p.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">Version {p.version}</span>
                  <InductionVideoStatusBadge status={p.status} stale={p.stale} />
                  <span className="text-xs text-ink-subtle">
                    started {p.startedOn} · {p.sceneCount}{' '}
                    {p.sceneCount === 1 ? 'scene' : 'scenes'}
                  </span>
                </div>

                {/*
                  * THE MISMATCH IS STATED IN FULL, naming both modules. This is the
                  * state that trapped Company Introduction: the asset had been
                  * re-pointed at a new module while the production kept the old
                  * one's wording, so "finish it" was never the right advice - the
                  * video would have been the wrong subject under this title.
                  */}
                {p.mismatched ? (
                  <p className="mt-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
                    <span className="font-semibold">This was produced from the wrong module.</span>{' '}
                    Its wording came from{' '}
                    <span className="font-semibold">“{p.fromModuleTitle}”</span>, but this library
                    video now stands in for{' '}
                    <span className="font-semibold">“{asset.moduleTitle}”</span>. Finishing it would
                    publish the wrong subject under this title — discard it and produce a new one.
                  </p>
                ) : p.stale ? (
                  <p className="mt-2 text-xs text-ink-muted">
                    “{p.fromModuleTitle}” has been issued again since this was produced
                    {p.fromModuleVersion ? ` from revision ${p.fromModuleVersion}` : ''}. Discard it
                    and produce a new one to pick up the current wording.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-ink-muted">
                    Produced from “{p.fromModuleTitle ?? 'a company module'}”
                    {p.fromModuleVersion ? ` revision ${p.fromModuleVersion}` : ''}.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Link
                    href={`${videoHrefBase}/${p.id}`}
                    className="rounded-lg border border-brand-300 bg-surface px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                  >
                    Open version {p.version}
                  </Link>
                  {/*
                    * Discarding is offered only where deleteVideoVersion would allow
                    * it - the page asks the same predicate the service enforces - and
                    * only to canIssue, because it is irreversible.
                    */}
                  {canIssue && p.discardable && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Discard version ${p.version} permanently? Its script and any ` +
                              'narration are deleted. This cannot be undone.',
                          )
                        ) {
                          return;
                        }
                        await call(
                          { action: 'discardProduction', assetId: asset.id, videoId: p.id },
                          `discard-${p.id}`,
                        );
                      }}
                      className="rounded-lg border border-danger-300 bg-surface px-3 py-1.5 text-xs font-semibold text-danger-700 hover:bg-danger-50 disabled:opacity-50"
                    >
                      {busy === `discard-${p.id}` ? 'Discarding…' : 'Discard it'}
                    </button>
                  )}
                  {!p.discardable && p.blockedReason && (
                    <span className="text-xs text-ink-subtle">{p.blockedReason}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── PRODUCE IT. The generated path: no upload, no external supplier. ── */}
      {canDraft && !editableContent && asset.active && (
        <section className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 shadow-card">
          <h3 className="text-sm font-bold text-ink">Produce this video</h3>
          <p className="mt-1 text-xs text-ink-muted">
            SiteComply turns{' '}
            <span className="font-semibold text-ink">“{asset.moduleTitle ?? 'the company module'}”</span>{' '}
            into a video: its approved wording becomes the narration, word for word. You then read
            the script, approve it, generate the voice-over and captions, render it, watch it, and
            publish it into this library video as a new revision.
          </p>
          {underWay.length > 0 ? (
            <p className="mt-2 rounded-lg border border-hivis-200 bg-hivis-50 px-3 py-2 text-xs text-hivis-800">
              <span className="font-semibold">
                Version {underWay[0].version} is already being produced.
              </span>{' '}
              Only one production runs at a time. Open it above to finish it, or discard it if it is
              no longer the video you want.
            </p>
          ) : !asset.moduleId ? (
            <p className="mt-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
              No company module is chosen yet. Pick one in Settings above — it is where the wording
              comes from.
            </p>
          ) : !sourceModuleReady ? (
            <p className="mt-2 rounded-lg border border-hivis-200 bg-hivis-50 px-3 py-2 text-xs text-hivis-800">
              <span className="font-semibold">“{asset.moduleTitle}” has no issued wording yet.</span>{' '}
              The video is produced from that wording word for word, so it has to be written and
              issued first. Nothing here is lost in the meantime.
            </p>
          ) : null}
          <button
            type="button"
            disabled={
              busy !== null || !asset.moduleId || !sourceModuleReady || underWay.length > 0
            }
            onClick={async () => {
              setBusy('produce');
              setError(null);
              try {
                const res = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ action: 'produce', assetId: asset.id }),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || !json?.videoId) {
                  setError(json?.error ?? 'That could not be started.');
                  /*
                   * REFRESH ON FAILURE TOO. The commonest refusal is "one is already
                   * being produced", and if this page was loaded before that
                   * production existed the panel naming it is not on screen yet -
                   * which is precisely the dead end being fixed. Refreshing brings
                   * the thing the message refers to into view.
                   */
                  router.refresh();
                  return;
                }
                router.push(`${videoHrefBase}/${json.videoId}`);
              } finally {
                setBusy(null);
              }
            }}
            className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy === 'produce' ? 'Starting…' : 'Produce the video from this module'}
          </button>
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
