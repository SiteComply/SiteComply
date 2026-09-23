import { prisma } from '@/lib/prisma';

/**
 * The companies working on one project.
 *
 * A company is a RECORD, not a typed string. Free text is how a roster ends up
 * holding "RS Electrical", "RS Elec - Test", "test" and "Test" on the same
 * project, which cannot be used to decide who sees whose RAMS. Managers pick
 * from this list; adding to it is a deliberate act.
 *
 * NAMES ARE NEVER MERGED AUTOMATICALLY. Two spellings may be one firm or two,
 * and only someone on that project knows. Uniqueness stops the SAME name being
 * added twice (case and spacing ignored); anything else is a human decision,
 * made with mergeCompanies().
 */

export interface SiteCompanyRow {
  id: string;
  name: string;
  /** Assignments pointing at this company, whatever their status. */
  operatives: number;
  /** Documents owned by this company. */
  documents: number;
  /** True when nothing points at it, so it can be removed. */
  removable: boolean;
}

/** Case- and spacing-insensitive comparison key. Storage keeps the typed name. */
export function normaliseCompanyName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type CompanyResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function listSiteCompanies(siteId: string): Promise<SiteCompanyRow[]> {
  const rows = await prisma.siteCompany.findMany({
    where: { jobSiteId: siteId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      _count: { select: { assignments: true, documents: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    operatives: r._count.assignments,
    documents: r._count.documents,
    removable: r._count.assignments === 0 && r._count.documents === 0,
  }));
}

export async function createSiteCompany(
  siteId: string,
  rawName: string,
  actor: { id: string; name: string },
): Promise<CompanyResult<{ id: string; name: string }>> {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    return { ok: false, error: 'Enter the company’s name.' };
  }
  if (name.length > 120) {
    return { ok: false, error: 'That name is too long.' };
  }

  // Checked here for the message; the database's unique index on the normalised
  // name is what actually guarantees it under a race.
  const existing = await findByName(siteId, name);
  if (existing) {
    return { ok: false, error: `${existing.name} is already on this project.` };
  }

  try {
    const row = await prisma.siteCompany.create({
      data: {
        jobSiteId: siteId,
        name,
        createdByUserId: actor.id,
        createdByName: actor.name,
      },
      select: { id: true, name: true },
    });
    return { ok: true, value: row };
  } catch {
    return { ok: false, error: 'That company is already on this project.' };
  }
}

export async function renameSiteCompany(
  siteId: string,
  companyId: string,
  rawName: string,
): Promise<CompanyResult<{ id: string; name: string }>> {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Enter the company’s name.' };

  const clash = await findByName(siteId, name);
  if (clash && clash.id !== companyId) {
    return { ok: false, error: `${clash.name} is already on this project.` };
  }
  const row = await prisma.siteCompany.updateMany({
    where: { id: companyId, jobSiteId: siteId },
    data: { name },
  });
  if (row.count === 0) return { ok: false, error: 'That company is not on this project.' };
  return { ok: true, value: { id: companyId, name } };
}

/**
 * Remove a company that nothing points at.
 *
 * Refused while operatives or documents are attached - deleting it would either
 * orphan a document or silently change what an operative can see. The caller is
 * told which, so "merge them first" is an obvious next step rather than a
 * puzzle.
 */
export async function removeSiteCompany(
  siteId: string,
  companyId: string,
): Promise<CompanyResult<{ removed: true }>> {
  const row = await prisma.siteCompany.findFirst({
    where: { id: companyId, jobSiteId: siteId },
    select: { name: true, _count: { select: { assignments: true, documents: true } } },
  });
  if (!row) return { ok: false, error: 'That company is not on this project.' };

  const { assignments, documents } = row._count;
  if (assignments > 0 || documents > 0) {
    const parts = [
      assignments > 0 ? `${assignments} operative${assignments === 1 ? '' : 's'}` : null,
      documents > 0 ? `${documents} document${documents === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    return {
      ok: false,
      error: `${row.name} still has ${parts.join(' and ')}. Move or merge them first.`,
    };
  }
  await prisma.siteCompany.delete({ where: { id: companyId } });
  return { ok: true, value: { removed: true } };
}

/**
 * Fold one company into another: a DELIBERATE act, never inferred from the
 * names. Everything pointing at the source is repointed, then the source goes.
 */
export async function mergeCompanies(
  siteId: string,
  fromId: string,
  intoId: string,
): Promise<CompanyResult<{ operatives: number; documents: number; into: string }>> {
  if (fromId === intoId) return { ok: false, error: 'Choose two different companies.' };
  const [from, into] = await Promise.all([
    prisma.siteCompany.findFirst({ where: { id: fromId, jobSiteId: siteId }, select: { id: true, name: true } }),
    prisma.siteCompany.findFirst({ where: { id: intoId, jobSiteId: siteId }, select: { id: true, name: true } }),
  ]);
  if (!from || !into) return { ok: false, error: 'Both companies must be on this project.' };

  const [operatives, documents] = await prisma.$transaction([
    prisma.workerSiteAssignment.updateMany({
      where: { jobSiteId: siteId, siteCompanyId: fromId },
      data: { siteCompanyId: intoId },
    }),
    prisma.document.updateMany({
      where: { jobSiteId: siteId, siteCompanyId: fromId },
      data: { siteCompanyId: intoId },
    }),
  ]);
  await prisma.siteCompany.delete({ where: { id: fromId } });
  return {
    ok: true,
    value: { operatives: operatives.count, documents: documents.count, into: into.name },
  };
}

/** The company an operative is engaged by on this project, or null. */
export async function companyForAssignment(
  workerId: string,
  siteId: string,
): Promise<{ id: string; name: string } | null> {
  const row = await prisma.workerSiteAssignment.findUnique({
    where: { workerId_jobSiteId: { workerId, jobSiteId: siteId } },
    select: { siteCompany: { select: { id: true, name: true } } },
  });
  return row?.siteCompany ?? null;
}

async function findByName(siteId: string, name: string) {
  const rows = await prisma.siteCompany.findMany({
    where: { jobSiteId: siteId },
    select: { id: true, name: true },
  });
  const key = normaliseCompanyName(name);
  return rows.find((r) => normaliseCompanyName(r.name) === key) ?? null;
}
