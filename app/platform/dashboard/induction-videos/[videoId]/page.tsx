import { notFound, redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { Breadcrumbs } from '@/components/platform/Breadcrumbs';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { canManageInductionVideos } from '@/services/inductionVideo/inductionVideoPermissions';
import { getVideo } from '@/services/inductionVideo/inductionVideoService';
import { formatDateTimeUK } from '@/lib/datetime';
import { InductionVideoStatusBadge } from '@/components/platform/InductionVideoStatusBadge';
import { ScriptEditor } from '@/components/platform/ScriptEditor';
import { NarrationPanel } from '@/components/platform/NarrationPanel';
import { estimateNarrationForScenes } from '@/services/inductionVideo/narrationService';
import { resolveSpeechSynthesiser } from '@/services/inductionVideo/speechSynthesiser';
import { mediaStorageConfigured } from '@/services/inductionVideo/mediaStorage';
import { formatRunningTime } from '@/services/inductionVideo/captions';
import { RenderPanel } from '@/components/platform/RenderPanel';
import { renderIsStale, renderingConfigured } from '@/services/inductionVideo/renderService';
import { viewsForVideo } from '@/services/inductionVideo/operativeVideoService';
import { spendForVideo, formatPence } from '@/services/inductionVideo/spendGuard';
import { overriddenRevisionIds } from '@/services/inductionModules/inductionModuleService';

export const dynamic = 'force-dynamic';

/** One version: its scenes, its history, and the decision to approve it. */
export default async function InductionVideoPage({
  params,
}: {
  params: { videoId: string };
}) {
  const viewer = await requirePlatformViewer();
  if (!canManageInductionVideos(viewer.role)) redirect('/platform/dashboard');

  const detail = await getVideo(viewer, params.videoId);
  if (!detail) notFound();
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
    <PlatformShell>
      <Breadcrumbs
        items={[
          { label: 'Induction videos', href: '/platform/dashboard/induction-videos' },
          {
            label: video.jobSite.name,
            href: `/platform/dashboard/sites/${video.jobSiteId}/induction-video`,
          },
          { label: `Version ${video.version}` },
        ]}
      />
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            Induction script · version {video.version}
          </h1>
          <p className="text-sm text-ink-muted">{video.jobSite.name}</p>
        </div>
        <span className="ml-auto">
          <InductionVideoStatusBadge status={video.status} stale={stale} />
        </span>
      </header>

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
        publishedBy={video.publishedByName}
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
              <span className="font-semibold text-ink">{e.action.replace(/_/g, ' ').toLowerCase()}</span>
              {e.detail && <span className="text-ink-muted">{e.detail}</span>}
              <span className="ml-auto text-xs text-ink-subtle">
                {formatDateTimeUK(e.createdAt)} · {e.actorName}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}

/** 0:42 — how long a single scene runs, in the form a player shows. */
function clockLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
