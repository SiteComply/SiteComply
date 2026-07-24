import { BulletinCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import {
  isBulletinCategory,
  BULLETIN_TITLE_MAX,
  BULLETIN_BODY_MAX,
} from '@/services/bulletins/bulletinConstants';

/**
 * Daily Bulletins service (SC-002).
 *
 * A bulletin belongs to exactly one site (the access boundary). Manager-facing
 * reads/writes are always constrained to the viewer's accessible `siteIds`, so a
 * user can never publish to or see bulletins for a site outside their scope.
 * Role-based permission checks (view/create/edit) live in the routes/pages via
 * `permits`; the site boundary is enforced here as defence in depth.
 *
 * The worker-facing helpers (list active + acknowledge) are keyed by an
 * authenticated workerId supplied by the caller (worker session), not a platform
 * viewer.
 */

// ---------------------------------------------------------------------------
// Manager side (platform)
// ---------------------------------------------------------------------------

export interface BulletinInput {
  jobSiteId?: string;
  category?: string;
  title?: string;
  body?: string;
}

export interface ValidatedBulletin {
  jobSiteId: string;
  category: BulletinCategory;
  title: string | null;
  body: string;
}

export type BulletinFieldErrors = Partial<Record<keyof BulletinInput, string>>;

/** Validate a bulletin against the viewer's scope. */
export function validateBulletin(
  input: BulletinInput,
  viewer: PlatformViewer,
):
  | { ok: true; value: ValidatedBulletin }
  | { ok: false; errors: BulletinFieldErrors } {
  const errors: BulletinFieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const jobSiteId = text(input.jobSiteId);
  if (!jobSiteId) errors.jobSiteId = 'Please choose a site.';
  else if (!viewer.siteIds.includes(jobSiteId))
    errors.jobSiteId = 'That site is not in your access.';

  const category = text(input.category) || 'NOTICE';
  if (!isBulletinCategory(category))
    errors.category = 'Please choose a valid category.';

  const title = text(input.title);
  if (title.length > BULLETIN_TITLE_MAX)
    errors.title = `Please keep the title under ${BULLETIN_TITLE_MAX} characters.`;

  const body = text(input.body);
  if (body.length < 2) errors.body = 'Please enter the bulletin message.';
  else if (body.length > BULLETIN_BODY_MAX)
    errors.body = `Please keep the message under ${BULLETIN_BODY_MAX} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      jobSiteId,
      category: category as BulletinCategory,
      title: title || null,
      body,
    },
  };
}

/** Publish a new bulletin. Records the publishing user (denormalised name). */
export async function createBulletin(
  viewer: PlatformViewer,
  value: ValidatedBulletin,
): Promise<{ ok: true; id: string }> {
  const created = await prisma.siteBulletin.create({
    data: {
      jobSiteId: value.jobSiteId,
      category: value.category,
      title: value.title,
      body: value.body,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

export interface BulletinSummary {
  id: string;
  category: BulletinCategory;
  title: string | null;
  body: string;
  active: boolean;
  publishedAt: Date;
  createdByName: string | null;
  readCount: number;
}

/** List a site's bulletins (most recent first), scoped to the viewer. */
export async function listBulletinsForSite(
  viewer: PlatformViewer,
  siteId: string,
  take = 20,
): Promise<BulletinSummary[]> {
  if (!viewer.siteIds.includes(siteId)) return [];
  const rows = await prisma.siteBulletin.findMany({
    where: { jobSiteId: siteId },
    orderBy: [{ active: 'desc' }, { publishedAt: 'desc' }],
    take,
    select: {
      id: true,
      category: true,
      title: true,
      body: true,
      active: true,
      publishedAt: true,
      createdByName: true,
      _count: { select: { reads: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    body: r.body,
    active: r.active,
    publishedAt: r.publishedAt,
    createdByName: r.createdByName,
    readCount: r._count.reads,
  }));
}

/**
 * Set a bulletin's active flag (archive/retract or re-activate). Scoped to the
 * viewer's sites. Returns notFound when the bulletin isn't in scope.
 */
export async function setBulletinActive(
  viewer: PlatformViewer,
  id: string,
  active: boolean,
): Promise<{ ok: true } | { notFound: true }> {
  const found = await prisma.siteBulletin.findFirst({
    where: { id, jobSiteId: { in: viewer.siteIds } },
    select: { id: true },
  });
  if (!found) return { notFound: true };
  await prisma.siteBulletin.update({ where: { id }, data: { active } });
  return { ok: true };
}

/** Permanently delete a bulletin (and its read rows via cascade). Viewer-scoped. */
export async function deleteBulletin(
  viewer: PlatformViewer,
  id: string,
): Promise<boolean> {
  const found = await prisma.siteBulletin.findFirst({
    where: { id, jobSiteId: { in: viewer.siteIds } },
    select: { id: true },
  });
  if (!found) return false;
  await prisma.siteBulletin.delete({ where: { id } });
  return true;
}

// ---------------------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------------------

export interface WorkerBulletin {
  id: string;
  category: BulletinCategory;
  title: string | null;
  body: string;
  publishedAt: Date;
  acknowledged: boolean;
}

/**
 * Active bulletins for a site, annotated with whether the given worker has read
 * (acknowledged) each. Ordered newest first.
 */
export async function listActiveBulletinsForWorker(
  siteId: string,
  workerId: string,
): Promise<WorkerBulletin[]> {
  const rows = await prisma.siteBulletin.findMany({
    where: { jobSiteId: siteId, active: true },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true,
      category: true,
      title: true,
      body: true,
      publishedAt: true,
      reads: { where: { workerId }, select: { id: true }, take: 1 },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    body: r.body,
    publishedAt: r.publishedAt,
    acknowledged: r.reads.length > 0,
  }));
}

/**
 * Record a worker's "I've read this" acknowledgement for a bulletin. Idempotent
 * (upsert on the unique bulletin/worker pair). Verifies the bulletin exists and
 * belongs to a site the worker is checked into is the caller's responsibility;
 * here we only require the bulletin to exist. Returns false if it doesn't.
 */
export async function acknowledgeBulletin(
  bulletinId: string,
  workerId: string,
): Promise<boolean> {
  const bulletin = await prisma.siteBulletin.findUnique({
    where: { id: bulletinId },
    select: { id: true },
  });
  if (!bulletin) return false;
  await prisma.siteBulletinRead.upsert({
    where: { bulletinId_workerId: { bulletinId, workerId } },
    create: { bulletinId, workerId },
    update: {},
  });
  return true;
}

/** Count of unacknowledged active bulletins for a worker on a site. */
export async function countUnreadBulletinsForWorker(
  siteId: string,
  workerId: string,
): Promise<number> {
  return prisma.siteBulletin.count({
    where: {
      jobSiteId: siteId,
      active: true,
      reads: { none: { workerId } },
    },
  });
}
