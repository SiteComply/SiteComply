import { createHash } from 'node:crypto';
import { CppRevisionStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canEditSite,
} from '@/services/platformUsers/platformPermissions';
import { getCppDraft, type CppDraft, type CppSection } from '@/services/sites/cppService';

/**
 * CPP document control Phase A — revisions of the Construction Phase Plan.
 *
 * The working draft stays a LIVE VIEW, exactly as it was: everything assembled
 * from current data, nothing stored. A revision is a FROZEN SNAPSHOT of that
 * view at a moment in time. The two are connected by a hash, so the system can
 * say when the plan in force no longer matches the site.
 *
 * That resolves a real tension rather than picking a side. The CPP was built as
 * a live view so it could never drift from what workers see; a controlled
 * document must be frozen or it is not a document. Draft live, revision frozen,
 * drift reported.
 */

/** What is frozen. Deliberately NOT the whole draft — see contentForHash. */
export interface CppSnapshot {
  site: CppDraft['site'];
  sections: CppSection[];
  drawings: CppDraft['drawings'];
  /** When the snapshot was taken, for the printed header. */
  takenAt: string;
}

/**
 * THE CONTENT THAT DECIDES WHETHER THE PLAN HAS CHANGED.
 *
 * Section titles, their entries and their list items — nothing else. Explicitly
 * excluded: `meta.generatedAt` (different on every single request), the
 * completeness figures (they move when an unrelated setup step is filled in),
 * and section status (a section can go PARTIAL→COMPLETE without its text
 * changing).
 *
 * Getting this wrong in either direction ruins the feature: hash too much and
 * every page load reports a change until nobody reads the notice; hash too
 * little and a real edit goes unannounced. Only what a reader would see as
 * different is included.
 */
function contentForHash(draft: CppDraft): unknown {
  return {
    site: draft.site,
    sections: draft.sections.map((s) => ({
      key: s.key,
      title: s.title,
      entries: s.entries
        .filter((e) => e.value !== null)
        .map((e) => [e.label, e.value]),
      items: s.items.map((i) => [i.label, i.detail]),
    })),
    drawings: draft.drawings.map((d) => [d.title, d.fileName]),
  };
}

export function hashDraft(draft: CppDraft): string {
  return createHash('sha256')
    .update(JSON.stringify(contentForHash(draft)))
    .digest('hex');
}

function snapshotOf(draft: CppDraft): CppSnapshot {
  return {
    site: draft.site,
    sections: draft.sections,
    drawings: draft.drawings,
    takenAt: new Date().toISOString(),
  };
}

export interface RevisionSummary {
  id: string;
  version: number;
  status: CppRevisionStatus;
  preparedByName: string;
  preparedAt: Date;
  issuedByName: string | null;
  issuedAt: Date | null;
  supersededAt: Date | null;
}

export interface RevisionState {
  revisions: RevisionSummary[];
  /** The revision in force, if any. */
  issued: RevisionSummary | null;
  /** An open draft revision, if one exists. Only ever one at a time. */
  draft: RevisionSummary | null;
  /**
   * Whether the live data differs from the ISSUED revision. Null when nothing
   * has been issued — there is nothing to drift from, which is not the same as
   * being up to date.
   */
  driftFromIssued: {
    changed: boolean;
    /** Titles of sections whose content differs. */
    changedSections: string[];
  } | null;
}

/** Section content as a comparable string, for the section-level diff. */
function sectionFingerprints(snapshot: CppSnapshot): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of snapshot.sections ?? []) {
    out.set(
      s.title,
      JSON.stringify([
        s.entries.filter((e) => e.value !== null).map((e) => [e.label, e.value]),
        s.items.map((i) => [i.label, i.detail]),
      ]),
    );
  }
  return out;
}

/**
 * Everything the revision switcher and the drift banner need.
 *
 * The diff is SECTION-LEVEL rather than a single flag, so a duty holder can see
 * what moved and judge whether it warrants a new revision. Software can detect a
 * change; only they can decide whether it is material.
 */
export async function getRevisionState(
  viewer: PlatformViewer,
  siteId: string,
  liveDraft: CppDraft,
): Promise<RevisionState | null> {
  if (!permits(viewer.role, 'sites', 'view')) return null;
  if (!viewer.siteIds.includes(siteId)) return null;

  const rows = await prisma.cppRevision.findMany({
    where: { jobSiteId: siteId },
    orderBy: { version: 'desc' },
    select: {
      id: true, version: true, status: true,
      preparedByName: true, preparedAt: true,
      issuedByName: true, issuedAt: true, supersededAt: true,
      contentHash: true, snapshot: true,
    },
  });

  const summaries: RevisionSummary[] = rows.map((r) => ({
    id: r.id, version: r.version, status: r.status,
    preparedByName: r.preparedByName, preparedAt: r.preparedAt,
    issuedByName: r.issuedByName, issuedAt: r.issuedAt,
    supersededAt: r.supersededAt,
  }));

  const issuedRow = rows.find((r) => r.status === CppRevisionStatus.ISSUED);
  const draftRow = rows.find((r) => r.status === CppRevisionStatus.DRAFT);

  let driftFromIssued: RevisionState['driftFromIssued'] = null;
  if (issuedRow) {
    const liveHash = hashDraft(liveDraft);
    const changed = liveHash !== issuedRow.contentHash;
    let changedSections: string[] = [];
    if (changed) {
      const before = sectionFingerprints(issuedRow.snapshot as unknown as CppSnapshot);
      const after = sectionFingerprints(snapshotOf(liveDraft));
      const titles = new Set([...before.keys(), ...after.keys()]);
      changedSections = [...titles].filter((t) => before.get(t) !== after.get(t));
    }
    driftFromIssued = { changed, changedSections };
  }

  return {
    revisions: summaries,
    issued: issuedRow ? summaries.find((s) => s.id === issuedRow.id)! : null,
    draft: draftRow ? summaries.find((s) => s.id === draftRow.id)! : null,
    driftFromIssued,
  };
}

/** One revision's frozen content, for viewing a historic plan. */
export async function getRevision(
  viewer: PlatformViewer,
  siteId: string,
  revisionId: string,
) {
  if (!permits(viewer.role, 'sites', 'view')) return null;
  if (!viewer.siteIds.includes(siteId)) return null;
  const row = await prisma.cppRevision.findFirst({
    where: { id: revisionId, jobSiteId: siteId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!row) return null;
  return { ...row, snapshot: row.snapshot as unknown as CppSnapshot };
}

export type RevisionResult =
  | { ok: true; revisionId: string; version: number }
  | { ok: false; error: string };

/**
 * Take a snapshot of the live plan as a new DRAFT revision.
 *
 * ONE OPEN DRAFT AT A TIME. A second would beg the question of which one gets
 * issued, and a snapshot is cheap to retake — so an existing draft is refused
 * with a message saying so rather than silently replaced.
 */
export async function createRevision(
  viewer: PlatformViewer,
  siteId: string,
): Promise<RevisionResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, error: 'You cannot create a revision for this site.' };
  }
  if (!viewer.siteIds.includes(siteId)) {
    return { ok: false, error: 'Site not found.' };
  }
  const existingDraft = await prisma.cppRevision.findFirst({
    where: { jobSiteId: siteId, status: CppRevisionStatus.DRAFT },
    select: { version: true },
  });
  if (existingDraft) {
    return {
      ok: false,
      error: `Revision ${existingDraft.version} is already open as a draft. Issue or discard it before starting another.`,
    };
  }

  const draft = await getCppDraft(viewer, siteId);
  if (!draft) return { ok: false, error: 'Site not found.' };

  const last = await prisma.cppRevision.findFirst({
    where: { jobSiteId: siteId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  const created = await prisma.cppRevision.create({
    data: {
      jobSiteId: siteId,
      version,
      status: CppRevisionStatus.DRAFT,
      snapshot: snapshotOf(draft) as unknown as Prisma.InputJsonValue,
      contentHash: hashDraft(draft),
      preparedByUserId: viewer.id,
      preparedByName: viewer.name,
      events: {
        create: {
          action: 'CREATED',
          actorUserId: viewer.id,
          actorName: viewer.name,
        },
      },
    },
    select: { id: true, version: true },
  });
  return { ok: true, revisionId: created.id, version: created.version };
}

/**
 * Issue a draft revision. It becomes the version in force, and whatever was
 * previously issued is superseded IN THE SAME TRANSACTION — two revisions in
 * force is a state that must never be observable.
 *
 * DIRECTOR-ONLY. Issuing is the act that makes a plan the one in force; with
 * APPROVED and ISSUED collapsed it is also the approval, so it is gated at the
 * duty-holder level now rather than being loosened later. Phase B adds the
 * signature and widens this to PRINCIPAL_CONTRACTOR.
 */
export async function issueRevision(
  viewer: PlatformViewer,
  siteId: string,
  revisionId: string,
  note?: string | null,
): Promise<RevisionResult> {
  if (!canEditSite(viewer.role)) {
    return {
      ok: false,
      error: 'Only a Director can issue a Construction Phase Plan.',
    };
  }
  if (!viewer.siteIds.includes(siteId)) {
    return { ok: false, error: 'Site not found.' };
  }
  const rev = await prisma.cppRevision.findFirst({
    where: { id: revisionId, jobSiteId: siteId },
    select: { id: true, version: true, status: true },
  });
  if (!rev) return { ok: false, error: 'Revision not found.' };
  if (rev.status !== CppRevisionStatus.DRAFT) {
    return { ok: false, error: `Revision ${rev.version} is not a draft.` };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await tx.cppRevision.findFirst({
      where: { jobSiteId: siteId, status: CppRevisionStatus.ISSUED },
      select: { id: true },
    });
    if (current) {
      await tx.cppRevision.update({
        where: { id: current.id },
        data: {
          status: CppRevisionStatus.SUPERSEDED,
          supersededAt: now,
          supersededByRevisionId: rev.id,
        },
      });
      await tx.cppRevisionEvent.create({
        data: {
          revisionId: current.id,
          action: 'SUPERSEDED',
          note: `Superseded by revision ${rev.version}.`,
          actorUserId: viewer.id,
          actorName: viewer.name,
        },
      });
    }
    await tx.cppRevision.update({
      where: { id: rev.id },
      data: {
        status: CppRevisionStatus.ISSUED,
        issuedAt: now,
        issuedByUserId: viewer.id,
        issuedByName: viewer.name,
      },
    });
    await tx.cppRevisionEvent.create({
      data: {
        revisionId: rev.id,
        action: 'ISSUED',
        note: note?.trim() || null,
        actorUserId: viewer.id,
        actorName: viewer.name,
      },
    });
  });
  return { ok: true, revisionId: rev.id, version: rev.version };
}

/**
 * Discard an unissued draft.
 *
 * Only a DRAFT can be deleted, and the guard is in the query rather than in a
 * branch above it: an issued or superseded revision is part of the record and
 * deleting one would defeat the entire point of this feature.
 */
export async function discardDraftRevision(
  viewer: PlatformViewer,
  siteId: string,
  revisionId: string,
): Promise<RevisionResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, error: 'You cannot change revisions for this site.' };
  }
  if (!viewer.siteIds.includes(siteId)) {
    return { ok: false, error: 'Site not found.' };
  }
  const deleted = await prisma.cppRevision.deleteMany({
    where: {
      id: revisionId,
      jobSiteId: siteId,
      status: CppRevisionStatus.DRAFT,
    },
  });
  if (deleted.count === 0) {
    return {
      ok: false,
      error: 'Only an unissued draft revision can be discarded.',
    };
  }
  return { ok: true, revisionId, version: 0 };
}
