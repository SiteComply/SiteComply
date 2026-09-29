import { prisma } from '@/lib/prisma';
import { moduleStatus } from '@/services/inductionModules/moduleStatus';
import { libraryStatus } from '@/services/inductionVideo/libraryStatus';
import { MODULE_CATALOGUE } from '@/services/inductionModules/moduleCatalogue';

/**
 * WHAT NEEDS SOMEBODY, ACROSS COMPANY MODULES AND THE LIBRARY.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The lists answer "where is the thing I came for". They do not answer "what is
 * wrong", and everything that has actually gone wrong with induction content was
 * quiet: a module reading "REPLACE THIS TEXT BEFORE ISSUING" that reached nobody, a
 * production wedged half-finished, a render that failed hours earlier. Each one was
 * visible only to somebody who already knew to look for it.
 *
 * ── IT INVENTS NO THIRD OPINION ───────────────────────────────────────────
 *
 * Whether a module or a video reaches anybody is asked of `moduleStatus` and
 * `libraryStatus` - the same derivations the lists and the detail pages render. A
 * strip with its own idea of "not live" would eventually contradict the row directly
 * beneath it, and the person reading both would have no way to tell which was right.
 * So this module decides only what is WORTH SAYING, never what is true.
 *
 * ── THE TARGET IS A KIND AND AN ID, NOT A URL ─────────────────────────────
 *
 * Hrefs differ between the Platform and the Admin Centre. Returning a built URL
 * would make this service tier-aware, and passing a builder in would be a function
 * prop - which is what took the Library index down in production. So each item names
 * WHAT it points at and the component joins it to that tier's base path.
 */

export type AttentionTarget =
  | { kind: 'module'; id: string }
  | { kind: 'asset'; id: string }
  | { kind: 'video'; id: string }
  | { kind: 'modules' }
  | { kind: 'library' };

export interface AttentionItem {
  /** Stable, so a React key and a test can both name one item. */
  key: string;
  /**
   * `action` is something nobody can do their job without; `watch` is worth knowing
   * and can wait. Two levels only: a third would invite arguing about the middle.
   */
  severity: 'action' | 'watch';
  title: string;
  detail: string;
  target: AttentionTarget;
  /** What the link should say. */
  action: string;
}

export interface Attention {
  items: AttentionItem[];
  /** So a screen can say "4 things need you" without counting twice. */
  actionCount: number;
}

/**
 * Everything worth saying, most urgent first.
 *
 * Ordered by severity and then by how long somebody has been living with it: a
 * failure from this morning matters more than a draft nobody has touched in a week,
 * and both matter more than a video that is merely ready to issue.
 */
export async function attentionItems(): Promise<Attention> {
  const [modules, assets, productions, failedJobs, failedNormalises] = await Promise.all([
    prisma.inductionModule.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        active: true,
        revisions: {
          orderBy: { version: 'desc' },
          select: { version: true, status: true, supersededAt: true },
        },
      },
    }),
    prisma.libraryAsset.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        title: true,
        active: true,
        moduleId: true,
        revisions: {
          orderBy: { version: 'desc' },
          select: {
            version: true,
            status: true,
            supersededAt: true,
            sourceBlobPath: true,
            normalisedBlobPath: true,
            captionsBlobPath: true,
            normaliseError: true,
          },
        },
      },
    }),
    // Company videos being produced. Not published means not finished.
    prisma.inductionVideo.findMany({
      where: { libraryAssetId: { not: null }, status: { not: 'PUBLISHED' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        sourceModuleRevisionId: true,
        libraryAssetId: true,
        libraryAsset: { select: { id: true, title: true, moduleId: true } },
      },
    }),
    prisma.inductionVideoJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        kind: true,
        error: true,
        videoId: true,
        video: {
          select: {
            version: true,
            jobSiteId: true,
            jobSite: { select: { name: true } },
            libraryAsset: { select: { id: true, title: true } },
          },
        },
      },
    }),
    prisma.libraryNormaliseJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        error: true,
        revision: {
          select: { version: true, asset: { select: { id: true, title: true } } },
        },
      },
    }),
  ]);

  const items: AttentionItem[] = [];

  /*
   * A STANDARD MODULE THAT IS NOT IN THE CATALOGUE. This is how production ended up
   * with six of seven, nothing able to create the seventh, and a "Company
   * Introduction" library video sourced from PPE wording.
   */
  const missing = MODULE_CATALOGUE.filter((c) => !modules.some((m) => m.slug === c.slug));
  if (missing.length > 0) {
    items.push({
      key: 'modules:missing-standard',
      severity: 'action',
      title:
        missing.length === 1
          ? `The standard module “${missing[0].title}” is not in your catalogue`
          : `${missing.length} standard modules are not in your catalogue`,
      detail:
        'Adding them creates drafts only — nothing you have written is touched, and ' +
        'nothing reaches an induction until it is issued.',
      target: { kind: 'modules' },
      action: 'Add them',
    });
  }

  /*
   * A MODULE THAT REACHES NOBODY. Asked of moduleStatus, so this cannot disagree with
   * the chip on the row.
   */
  for (const m of modules) {
    const issued = m.revisions.find((r) => r.status === 'ISSUED' && !r.supersededAt) ?? null;
    const draft = m.revisions.find((r) => r.status === 'DRAFT') ?? null;
    const status = moduleStatus({
      active: m.active,
      issued: issued ? { version: issued.version } : null,
      draft: draft ? { version: draft.version } : null,
    });
    if (status.reachesOperatives) continue;
    items.push({
      key: `module:${m.id}:unissued`,
      severity: 'action',
      title: `“${m.title}” reaches nobody`,
      detail: status.detail,
      target: { kind: 'module', id: m.id },
      action: draft ? 'Read it and issue it' : 'Write it',
    });
  }

  /*
   * A LIBRARY VIDEO THAT REACHES NOBODY, and separately one that is ready to issue.
   * Both come from libraryStatus rather than from a second reading of the revisions.
   */
  for (const a of assets) {
    const issued = a.revisions.find((r) => r.status === 'ISSUED' && !r.supersededAt) ?? null;
    const draft = a.revisions.find((r) => r.status === 'DRAFT') ?? null;
    const status = libraryStatus({
      active: a.active,
      issued: issued ? { version: issued.version } : null,
      draft: draft
        ? {
            version: draft.version,
            hasFootage: Boolean(draft.sourceBlobPath),
            normalised: Boolean(draft.normalisedBlobPath),
            hasCaptions: Boolean(draft.captionsBlobPath),
            normaliseError: draft.normaliseError,
          }
        : null,
    });

    if (!status.reachesOperatives) {
      items.push({
        key: `asset:${a.id}:not-live`,
        // Always `action`: a library video nobody can see is a job half done,
        // whatever stage it stalled at. The stage itself is in `detail`.
        severity: 'action',
        title: `“${a.title}” is not in any induction yet`,
        detail: status.detail,
        target: { kind: 'asset', id: a.id },
        action: 'Open it',
      });
      continue;
    }
    // Live already, but with a replacement waiting on a decision.
    if (status.key === 'LIVE_WITH_DRAFT') {
      items.push({
        key: `asset:${a.id}:draft-waiting`,
        severity: 'watch',
        title: `“${a.title}” has revision ${draft?.version} prepared but not issued`,
        detail: status.detail,
        target: { kind: 'asset', id: a.id },
        action: 'Review it',
      });
    }
  }

  /*
   * A PRODUCTION THAT IS NOT FINISHED — and the one case that is worse than unfinished:
   * produced from a module the asset no longer points at. That state wedged Company
   * Introduction in production and took hand-written SQL to clear.
   */
  /*
   * Which module each production's wording actually came from, resolved in ONE query
   * for all of them rather than one per production.
   */
  const sourceRevisionIds = productions
    .map((p) => p.sourceModuleRevisionId)
    .filter((id): id is string => Boolean(id));
  const sourceModuleByRevision = new Map(
    sourceRevisionIds.length
      ? (
          await prisma.inductionModuleRevision.findMany({
            where: { id: { in: sourceRevisionIds } },
            select: { id: true, moduleId: true, module: { select: { title: true } } },
          })
        ).map((r) => [r.id, r])
      : [],
  );

  for (const p of productions) {
    const source = p.sourceModuleRevisionId
      ? sourceModuleByRevision.get(p.sourceModuleRevisionId)
      : undefined;
    /*
     * PRODUCED FROM A MODULE THE ASSET NO LONGER POINTS AT. Worse than unfinished:
     * finishing it publishes the wrong subject under this title. This is the state
     * that wedged Company Introduction in production and took hand-written SQL to
     * clear, so it gets its own wording and its own severity.
     */
    const mismatched = Boolean(
      source && p.libraryAsset?.moduleId && source.moduleId !== p.libraryAsset.moduleId,
    );
    const title = p.libraryAsset?.title ?? 'a library video';

    if (mismatched) {
      items.push({
        key: `video:${p.id}:mismatched`,
        severity: 'action',
        title: `“${title}” version ${p.version} was produced from the wrong module`,
        detail:
          `Its wording came from “${source?.module.title}”, which is not what this ` +
          'library video stands in for. Finishing it would publish the wrong subject — ' +
          'discard it and produce a new one.',
        target: { kind: 'video', id: p.id },
        action: 'Review it',
      });
      continue;
    }

    items.push({
      key: `video:${p.id}:unfinished`,
      severity: p.status === 'GENERATION_FAILED' ? 'action' : 'watch',
      title:
        p.status === 'GENERATION_FAILED'
          ? `Producing “${title}” version ${p.version} failed`
          : `“${title}” version ${p.version} is part-produced`,
      detail:
        p.status === 'GENERATION_FAILED'
          ? 'The narration or the render did not finish. Trying again is safe — the script and the approval are untouched.'
          : 'Only one production runs at a time, so this has to be finished or discarded before another can start.',
      target: { kind: 'video', id: p.id },
      action: p.status === 'GENERATION_FAILED' ? 'See what failed' : 'Open it',
    });
  }

  /* A FAILED JOB. The status a failed job never got to write is not what tells anybody. */
  for (const j of failedJobs) {
    const where = j.video?.jobSite?.name ?? j.video?.libraryAsset?.title ?? 'an induction video';
    items.push({
      key: `job:${j.id}:failed`,
      severity: 'action',
      title: `${j.kind === 'RENDER' ? 'Rendering' : j.kind === 'NARRATION' ? 'Narrating' : 'Writing the script for'} “${where}” failed`,
      detail: j.error
        ? `${j.error.slice(0, 160)} — trying again is safe.`
        : 'No reason was recorded. Trying again is safe.',
      target: { kind: 'video', id: j.videoId },
      action: 'Open the version',
    });
  }

  for (const n of failedNormalises) {
    items.push({
      key: `normalise:${n.id}:failed`,
      severity: 'action',
      title: `Preparing footage for “${n.revision?.asset?.title ?? 'a library video'}” failed`,
      detail: n.error
        ? `${n.error.slice(0, 160)} — upload it again or try a different export.`
        : 'No reason was recorded. Uploading it again is safe.',
      target: n.revision?.asset
        ? { kind: 'asset', id: n.revision.asset.id }
        : { kind: 'library' },
      action: 'Open it',
    });
  }

  const order = { action: 0, watch: 1 } as const;
  items.sort((x, y) => order[x.severity] - order[y.severity]);

  return { items, actionCount: items.filter((i) => i.severity === 'action').length };
}
