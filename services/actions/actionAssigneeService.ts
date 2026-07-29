import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { ROLE_LABELS } from '@/services/platformUsers/platformUserConstants';

/**
 * SC-015 — who an action may be assigned to on a given site.
 *
 * "Currently inducted" (the approved Option A) resolves against SC-006 induction
 * validity:
 *  - Site HAS `inductionValidityDays` configured → the worker's most recent FULL
 *    induction must still be within that window.
 *  - Site does NOT (the default — SC-006 ships dark, null = re-induct every
 *    visit) → there is no expiry to test, so a completed full induction counts.
 * Either way a manager's `inductionsInvalidatedAt` cutoff is honoured: inductions
 * completed at or before it no longer count.
 *
 * Fallback: when a site has NO inducted workers, actions would otherwise be
 * impossible to raise there, so the platform users assigned to that site are
 * offered instead. That keeps a brand-new site usable without weakening the rule
 * where real workers exist.
 */

export type AssigneeKind = 'WORKER' | 'PLATFORM_USER';

export interface AssignablePerson {
  kind: AssigneeKind;
  id: string;
  name: string;
  /** Employer for a worker, role label for a platform user. */
  company: string;
}

export interface AssignablePeople {
  people: AssignablePerson[];
  /** True when the list is the platform-user fallback, not inducted workers. */
  isFallback: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Inducted workers for a site, newest induction first then alphabetical. One row
 * per worker. Set-based (a single submissions query) rather than calling
 * getInductionValidity per worker, which would be N+1 on a busy site.
 */
export async function listInductedWorkers(
  siteId: string,
): Promise<AssignablePerson[]> {
  const config = await prisma.siteInductionConfig.findUnique({
    where: { jobSiteId: siteId },
    select: { inductionValidityDays: true, inductionsInvalidatedAt: true },
  });
  const validityDays = config?.inductionValidityDays ?? null;
  const invalidatedAt = config?.inductionsInvalidatedAt ?? null;

  const submissions = await prisma.submission.findMany({
    where: {
      jobSiteId: siteId,
      status: SubmissionStatus.COMPLIANT,
      // Only FULL inductions establish "inducted" — an express (reused) check-in
      // inherits its induction from an earlier full one, which is the row that
      // carries the real completion date.
      inductionReused: false,
      ...(invalidatedAt ? { checkedInAt: { gt: invalidatedAt } } : {}),
    },
    orderBy: { checkedInAt: 'desc' },
    select: {
      checkedInAt: true,
      worker: { select: { id: true, fullName: true, company: true } },
    },
  });

  const now = Date.now();
  const seen = new Set<string>();
  const people: AssignablePerson[] = [];
  for (const s of submissions) {
    if (seen.has(s.worker.id)) continue; // newest induction per worker wins
    seen.add(s.worker.id);
    if (validityDays != null) {
      const expiresAt = s.checkedInAt.getTime() + validityDays * DAY_MS;
      if (expiresAt <= now) continue; // induction has lapsed
    }
    people.push({
      kind: 'WORKER',
      id: s.worker.id,
      name: s.worker.fullName,
      company: s.worker.company,
    });
  }

  people.sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  return people;
}

/** Active platform users assigned to the site — the no-inducted-workers fallback. */
export async function listSitePlatformUsers(
  siteId: string,
): Promise<AssignablePerson[]> {
  const users = await prisma.platformUser.findMany({
    where: { status: 'ACTIVE', assignedSites: { some: { id: siteId } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, company: true, role: true },
  });
  return users.map((u) => ({
    kind: 'PLATFORM_USER' as const,
    id: u.id,
    name: u.name,
    company: u.company || (ROLE_LABELS[u.role] ?? 'Platform user'),
  }));
}

/**
 * The assignable people for a site, site-scoped to the viewer. Returns null when
 * the site is outside the viewer's access so callers can 404 rather than reveal
 * that the site exists (this endpoint exposes worker names + employers).
 */
export async function getAssignablePeople(
  viewer: PlatformViewer,
  siteId: string,
): Promise<AssignablePeople | null> {
  if (!viewer.siteIds.includes(siteId)) return null;

  const workers = await listInductedWorkers(siteId);
  if (workers.length > 0) return { people: workers, isFallback: false };

  const fallback = await listSitePlatformUsers(siteId);
  return { people: fallback, isFallback: true };
}

/**
 * Resolve a chosen assignee to the snapshot fields stored on the action. Returns
 * null when the person is not assignable for that site — the server-side re-check
 * that makes the dropdown advisory rather than authoritative.
 */
export async function resolveAssignee(
  viewer: PlatformViewer,
  siteId: string,
  kind: AssigneeKind,
  id: string,
): Promise<{
  assignedTo: string;
  assignedToCompany: string;
  assignedWorkerId: string | null;
  assignedPlatformUserId: string | null;
} | null> {
  const assignable = await getAssignablePeople(viewer, siteId);
  if (!assignable) return null;
  const match = assignable.people.find((p) => p.kind === kind && p.id === id);
  if (!match) return null;
  return {
    assignedTo: match.name,
    assignedToCompany: match.company,
    assignedWorkerId: kind === 'WORKER' ? id : null,
    assignedPlatformUserId: kind === 'PLATFORM_USER' ? id : null,
  };
}
