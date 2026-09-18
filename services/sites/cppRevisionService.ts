import { createHash } from 'node:crypto';
import { CppRevisionStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  permits,
  canIssueCpp,
} from '@/services/platformUsers/platformPermissions';
import {
  buildBlobPath,
  uploadDocumentBlob,
} from '@/services/documents/blobStorage';
import {
  parseSignatureInput,
  type SignatureInput,
} from '@/services/inductionSignature/signatureService';
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

/**
 * THE DECLARATION A DUTY HOLDER ACCEPTS WHEN ISSUING.
 *
 * Deliberately narrow about what software can and cannot attest. SiteComply
 * assembles the plan; it cannot warrant that the plan is suitable or sufficient,
 * and that judgement is the Principal Contractor's duty under CDM 2015. The
 * declaration therefore asks the approver to confirm THEIR judgement, not to
 * countersign the system's.
 *
 * Snapshotted onto each revision, so changing this wording never rewrites what
 * somebody already signed.
 */
export const CPP_APPROVAL_DECLARATION =
  'I confirm that I have reviewed this Construction Phase Plan, that I am authorised to approve it for this project, and that in my judgement it is suitable and sufficient for the construction work to which it relates. I understand that it must be reviewed and revised as the work proceeds.';

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
  /**
   * Passed straight through from the live draft so the recommended next action
   * can be computed in ONE place. Document control and completion were built in
   * separate phases and never introduced to each other — the revision service
   * had no idea whether the plan it was snapshotting had holes in it.
   */
  readiness: CppDraft['readiness'];
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
    readiness: liveDraft.readiness,
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
  signature?: unknown,
): Promise<RevisionResult> {
  if (!canIssueCpp(viewer.role)) {
    return {
      ok: false,
      error:
        'Only a Director or Principal Contractor can approve and issue a Construction Phase Plan.',
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

  /*
   * A SIGNATURE IS REQUIRED TO ISSUE.
   *
   * Issuing is the approval, so there is no unsigned route to it — an issued
   * plan with no named approver would be exactly the blank-lines-and-a-pen
   * problem this replaced, only harder to notice because it would look official.
   */
  const parsed = parseSignatureInput(signature);
  if (!parsed) {
    return {
      ok: false,
      error: 'A signature is required to approve and issue the plan.',
    };
  }
  const approval = await buildApprovalRecord(siteId, parsed);
  if (!approval.ok) return { ok: false, error: approval.error };

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
        // issuedAt/issuedByName ARE the approval timestamp and approver —
        // approving and issuing are one act, and a second pair of fields would
        // be duplicate state that could disagree.
        issuedAt: now,
        issuedByUserId: viewer.id,
        issuedByName: viewer.name,
        // The role held AT THE TIME of approval. People change role; the
        // question a reviewer asks is what authority this person had then.
        approverRole: viewer.role,
        declarationText: CPP_APPROVAL_DECLARATION,
        signedName: approval.record.signedName,
        signatureType: approval.record.signatureType,
        signatureBlobPath: approval.record.signatureBlobPath,
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

/**
 * Validate a signature and store a drawn one privately.
 *
 * Mirrors the induction's buildSignatureRecord rather than reusing it, because
 * that one returns fields shaped for a Submission and writes the induction's own
 * declaration. The VALIDATION is shared — parseSignatureInput — which is the part
 * that must not diverge.
 */
async function buildApprovalRecord(
  siteId: string,
  input: SignatureInput,
): Promise<
  | {
      ok: true;
      record: {
        signedName: string;
        signatureType: 'DRAWN' | 'TYPED';
        signatureBlobPath: string | null;
      };
    }
  | { ok: false; error: string }
> {
  if (input.type === 'TYPED') {
    return {
      ok: true,
      record: {
        signedName: input.name,
        signatureType: 'TYPED',
        signatureBlobPath: null,
      },
    };
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(
    input.dataUrl ?? '',
  );
  if (!match) return { ok: false, error: 'The signature image is invalid.' };
  const buffer = Buffer.from(match[1]!, 'base64');
  // Same ceiling as the induction signature: a canvas PNG that exceeds it is a
  // malformed or hostile payload rather than a signature.
  if (buffer.length === 0 || buffer.length > 400_000) {
    return { ok: false, error: 'The signature image is too large.' };
  }
  const blobPath = buildBlobPath(siteId, 'cpp-approval-signature.png');
  await uploadDocumentBlob(blobPath, buffer, 'image/png');
  return {
    ok: true,
    record: {
      signedName: input.name,
      signatureType: 'DRAWN',
      signatureBlobPath: blobPath,
    },
  };
}

/** The stored signature image for one revision, for the approval block. */
export async function getApprovalSignatureBlobPath(
  viewer: PlatformViewer,
  siteId: string,
  revisionId: string,
): Promise<string | null> {
  if (!permits(viewer.role, 'sites', 'view')) return null;
  if (!viewer.siteIds.includes(siteId)) return null;
  const row = await prisma.cppRevision.findFirst({
    where: { id: revisionId, jobSiteId: siteId },
    select: { signatureBlobPath: true },
  });
  return row?.signatureBlobPath ?? null;
}
