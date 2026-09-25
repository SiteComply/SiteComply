import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
import { ScriptEditor } from '@/components/platform/ScriptEditor';
import { NarrationPanel } from '@/components/platform/NarrationPanel';
import { RenderPanel } from '@/components/platform/RenderPanel';
import { estimateNarrationForScenes } from '@/services/inductionVideo/narrationService';
import { resolveSpeechSynthesiser } from '@/services/inductionVideo/speechSynthesiser';
import { mediaStorageConfigured } from '@/services/inductionVideo/mediaStorage';
import { formatRunningTime } from '@/services/inductionVideo/captions';
import { renderIsStale, renderingConfigured } from '@/services/inductionVideo/renderService';
import { viewsForVideo } from '@/services/inductionVideo/operativeVideoService';
import { spendForVideo, formatPence } from '@/services/inductionVideo/spendGuard';
import { overriddenRevisionIds } from '@/services/inductionModules/inductionModuleService';
import { describeVideoRealm } from '@/services/inductionVideo/videoActor';
import { RefreshWhileWorking } from '@/components/inductionVideo/RefreshWhileWorking';
import { DeleteVersionButton } from '@/components/inductionVideo/DeleteVersionButton';
import { versionMayBeDeleted } from '@/services/inductionVideo/inductionVideoService';
import { describeWork, isWorkingStatus } from '@/services/inductionVideo/videoProgress';
import { formatDateTimeUK } from '@/lib/datetime';

/**
 * EVERYTHING YOU DO TO ONE VERSION OF AN INDUCTION VIDEO — for both tiers.
 *
 * Script review and editing, approval, narration, rendering, publishing,
 * withdrawal, who has watched it, and the history. The Platform and the Admin
 * Centre are two entry points into one system, so this surface is assembled once
 * and rendered in both shells. The only thing either tier passes that differs is
 * `apiBase`: which route the panels post to.
 *
 * ── WHY THIS IS ONE COMPONENT AND NOT TWO PAGES ───────────────────────────
 *
 * The assembly is the part that rots. Deciding that narration needs a voice AND
 * somewhere to put the audio, that only unnarrated scenes are chargeable, that
 * overrides are read live rather than off the scene — each of those is a judgement
 * that has to be identical in both tiers or the two screens quietly disagree about
 * the same version. Sharing the panels but duplicating the assembly would have
 * looked like sharing while leaving every one of those decisions to drift.
 *
 * Permissions are NOT decided here. Each tier resolves its own actor and passes
 * `canApprove`; this renders what it is told.
 */
export async function VideoVersionSurface({
  detail,
  apiBase,
  projectHref,
}: {
  /** The result of `getVideo(actor, videoId)` — already authorised by the caller. */
  detail: NonNullable<Awaited<ReturnType<typeof import('@/services/inductionVideo/inductionVideoService').getVideo>>>;
  /** The tier's route for this version, e.g. `/api/admin/induction-video/<id>`. */
  apiBase: string;
  /**
   * Where to go after deleting, since the page being looked at ceases to exist.
   * Each tier passes its own project page.
   */
  projectHref: string;
}) {
  const { video, stale, warnings, canApprove } = detail;

  const blocking = Array.isArray(video.blockingReasons)
    ? (video.blockingReasons as { heading: string; message: string }[])
    : [];

  /*
   * NARRATION NEEDS BOTH A VOICE AND SOMEWHERE TO PUT THE AUDIO. Checking only
   * the speech service would offer a button that fails on the upload, which is
   * a worse explanation than a panel that says what is not set up.
   */
  const narrationConfigured = Boolean(resolveSpeechSynthesiser()) && mediaStorageConfigured();
  // Only the scenes that would actually be bought: the rest are reused.
  const unnarrated = video.scenes.filter((s) => !s.audioDurationMs).map((s) => s.narration);
  const lastNarrationError =
    video.jobs.find((j) => j.kind === 'NARRATION' && j.status === 'FAILED')?.error ?? null;
  const lastRenderError =
    video.jobs.find((j) => j.kind === 'RENDER' && j.status === 'FAILED')?.error ?? null;
  const [views, spend] = await Promise.all([viewsForVideo(video.id), spendForVideo(video.id)]);
  /*
   * Which company modules this project has departed from. Read from the site's
   * own decisions rather than stored on the scene: an override recorded after a
   * script was generated should show as a departure the moment it is made, not
   * only after the next regeneration.
   */
  const overriddenModuleRevisions = await overriddenRevisionIds(video.jobSiteId);

  return (
    <>
      {/*
       * Narration and rendering are queued jobs that start immediately, so this
       * screen is the one waiting on them. Rendered here rather than in each
       * tier's page so both get it from one place.
       */}
      <RefreshWhileWorking
        working={isWorkingStatus(video.status)}
        label={describeWork(video.status)}
      />

      {blocking.length > 0 && (
        <section className="mb-5 rounded-xl border border-danger-500/40 bg-danger-50 p-4">
          <h2 className="text-sm font-bold text-danger-700">Information required</h2>
          <ul className="mt-2 space-y-2">
            {blocking.map((b) => (
              <li key={b.heading} className="text-sm text-danger-700">
                <span className="font-semibold">{b.heading}:</span> {b.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stale && (
        <p className="mb-5 rounded-xl border border-hivis-500/40 bg-hivis-400/10 px-4 py-3 text-sm text-ink">
          This project’s information has changed since this version was
          generated. It is kept as it stands; generate a new version to take the
          changes in.
        </p>
      )}

      {warnings.length > 0 && (
        <div className="mb-5 rounded-xl border border-line bg-surface-sunken px-4 py-3">
          <p className="text-xs font-semibold text-ink">Worth knowing</p>
          <ul className="mt-1 space-y-1">
            {warnings.map((w) => (
              <li key={w} className="text-xs text-ink-muted">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ScriptEditor
        endpoint={apiBase}
        videoId={video.id}
        status={video.status}
        canApprove={canApprove}
        scenes={video.scenes.map((s) => ({
          id: s.id,
          sceneType: s.sceneType,
          heading: s.heading,
          narration: s.narration,
          required: s.required,
          sourceRefs: Array.isArray(s.sourceRefs) ? (s.sourceRefs as string[]) : [],
          companyModule: Boolean(s.moduleRevisionId),
          overridden: overriddenModuleRevisions.has(s.moduleRevisionId ?? ''),
        }))}
      />

      <NarrationPanel
        endpoint={apiBase}
        videoId={video.id}
        status={video.status}
        configured={narrationConfigured}
        scenes={video.scenes.map((s) => ({
          id: s.id,
          heading: s.heading,
          duration: s.audioDurationMs ? clockLabel(s.audioDurationMs) : null,
        }))}
        totalLabel={video.narrationDurationMs ? formatRunningTime(video.narrationDurationMs) : null}
        voice={video.voice}
        narratedOn={video.narrationAt ? formatDateTimeUK(video.narrationAt) : null}
        hasCaptions={Boolean(video.captionsBlobPath)}
        hasTranscript={Boolean(video.transcriptBlobPath)}
        estimatePence={estimateNarrationForScenes(unnarrated).pence}
        lastError={lastNarrationError}
      />

      <RenderPanel
        endpoint={apiBase}
        videoId={video.id}
        status={video.status}
        configured={renderingConfigured()}
        stale={renderIsStale(video)}
        canPublish={canApprove}
        durationLabel={video.videoDurationMs ? formatRunningTime(video.videoDurationMs) : null}
        sizeLabel={
          video.videoSizeBytes ? `${(video.videoSizeBytes / 1_048_576).toFixed(1)} MB` : null
        }
        engine={video.renderEngine}
        renderedOn={video.renderedAt ? formatDateTimeUK(video.renderedAt) : null}
        publishedOn={video.publishedAt ? formatDateTimeUK(video.publishedAt) : null}
        publishedBy={publishedByLabel(video.publishedByName, video.publishedByRealm)}
        watchedCount={views.length}
        completedCount={views.filter((v) => v.completedAt).length}
        lastError={lastRenderError}
      />

      {views.length > 0 && (
        <section className="mt-6 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-sm font-bold text-ink">Who has watched this version</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            The record of the induction itself: an operative inducted against this
            version stays recorded against it after a newer one is published.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {views.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-semibold text-ink">{v.workerName}</span>
                {v.completedAt ? (
                  <span className="rounded-full bg-safe-50 px-2 py-0.5 text-xs font-semibold text-safe-700">
                    Watched in full
                  </span>
                ) : (
                  <span className="rounded-full bg-hivis-400/20 px-2 py-0.5 text-xs font-semibold text-hivis-600">
                    {v.videoDurationMs
                      ? `Stopped at ${Math.round((v.furthestMs / v.videoDurationMs) * 100)}%`
                      : 'Started'}
                  </span>
                )}
                <span className="ml-auto text-xs text-ink-subtle">
                  {formatDateTimeUK(v.completedAt ?? v.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">History</h2>
        <p className="mt-0.5 text-xs text-ink-subtle">
          {spend.pence > 0 && (
            <>
              This version has cost {formatPence(spend.pence)} so far
              {spend.renderPence > 0 ? ` (${formatPence(spend.renderPence)} of it rendering)` : ''}.{' '}
            </>
          )}
          {video.provider
            ? `Generated by ${video.provider}${video.model ? ` · ${video.model}` : ''}${
                video.promptVersion ? ` · ${video.promptVersion}` : ''
              }`
            : 'Not generated yet.'}
        </p>
        <ul className="mt-2 divide-y divide-line">
          {video.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-2 py-2 text-sm">
              <span className="font-semibold text-ink">
                {e.action.replace(/_/g, ' ').toLowerCase()}
              </span>
              {e.detail && <span className="text-ink-muted">{e.detail}</span>}
              <span className="ml-auto text-xs text-ink-subtle">
                {/*
                 * The realm is shown wherever an action is attributed. Both tiers
                 * can now approve and publish, so "approved by Jane Smith" without
                 * it would leave two kinds of authority indistinguishable.
                 */}
                {formatDateTimeUK(e.createdAt)} · {e.actorName}
                {describeVideoRealm(e.actorRealm) ? ` (${describeVideoRealm(e.actorRealm)})` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/*
       * LAST ON THE PAGE, deliberately. A destructive action at the top competes
       * with the work; at the bottom it is found by someone who has decided.
       *
       * Offered only when the version never entered the record - the same
       * predicate the service enforces, asked here so a button is not shown that
       * would only be refused. `canApprove` because deleting is irreversible and
       * belongs with the roles that own the record.
       */}
      {canApprove &&
        versionMayBeDeleted({
          status: video.status,
          publishedAt: video.publishedAt,
          supersededAt: video.supersededAt,
          viewCount: views.length,
        }) && (
          <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-sunken px-4 py-3">
            <p className="text-sm text-ink-muted">
              This version has not been approved, published or watched by anyone.
              It can be deleted permanently — useful while iterating on content.
            </p>
            <DeleteVersionButton
              endpoint={apiBase}
              version={video.version}
              afterHref={projectHref}
            />
          </section>
        )}
    </>
  );
}

/** "Jane Smith (Admin Centre)" — who published, and from where. */
function publishedByLabel(name: string | null, realm: string | null): string | null {
  if (!name) return null;
  const where = describeVideoRealm(realm);
  return where ? `${name} (${where})` : name;
}

/** 0:42 — how long a single scene runs, in the form a player shows. */
function clockLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
