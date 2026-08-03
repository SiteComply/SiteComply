import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * SC-025 — the read-only rule for completed projects.
 *
 * WHY THIS EXISTS AS A DATA-LAYER GUARD. There are 96 mutating API routes and
 * 38 site-scoped writing services in this codebase, and no single permission
 * function they all pass through (`viewerCan` is site-aware but used in a
 * handful of places; `permits()` is used everywhere but takes no site id). So
 * "completed projects are read-only" cannot be delivered by editing one gate,
 * and hand-placing 38 guards would leave gaps the day someone adds the 39th
 * write. This guard sits under all of them, and covers code not yet written.
 *
 * It is a BACKSTOP, not the whole story: the service layer also refuses
 * explicitly, so users get a sentence explaining why rather than an exception.
 */

/** Thrown when a write is attempted against a completed project. */
export class ProjectClosedError extends Error {
  readonly siteId: string;
  constructor(siteId: string) {
    super(
      'This project has been completed and its records are read-only. Reopen the project to make changes.',
    );
    this.name = 'ProjectClosedError';
    this.siteId = siteId;
  }
}

/**
 * Models that stay writable on a completed project, and why.
 *
 * Each entry is a deliberate exception, not a convenience. Anything not listed
 * is frozen.
 */
export const CLOSED_PROJECT_WRITABLE_MODELS = new Set<string>([
  // The requirement explicitly keeps this available after completion:
  // "The final close-out pack can be generated."
  'CloseOutPack',
  'CloseOutPackShare',
  'CloseOutPackShareView',
  // The AI narrative and its audit log belong to the pack.
  'AiSummary',
  // The closure audit trail itself — written BY closing and reopening.
  'SiteClosureEvent',
  // Restoring user access is an explicit part of reopening, and permission
  // changes carry their own audit log.
  'SiteUserPermission',
  'PermissionChangeLog',
  // Suspended by closure, restored by reopening.
  'WorkerSiteAssignment',
  'WorkerAssignmentEvent',
  // Stopped by closure; a manager may turn schedules back on after reopening.
  'ComplianceSchedule',
  // Delivery logs are records of things that already happened.
  'SmsMessageLog',
]);

/**
 * Lifecycle bypass.
 *
 * `closeProject` sets the site to COMPLETED and then, in the same transaction,
 * suspends assignments and stops schedules — writes that the guard would
 * otherwise reject, because by then the project IS closed. Rather than punch
 * permanent holes for those models, closure runs inside this scope.
 *
 * AsyncLocalStorage rather than a module-level flag: a global would leak across
 * concurrent requests on a shared server and silently disable the guard for
 * whatever else happened to be running.
 */
const lifecycleScope = new AsyncLocalStorage<true>();

export function runProjectLifecycleWrite<T>(fn: () => Promise<T>): Promise<T> {
  return lifecycleScope.run(true, fn);
}

export function inProjectLifecycleWrite(): boolean {
  return lifecycleScope.getStore() === true;
}

/**
 * Cache of completed site ids.
 *
 * A database round trip per write would be a real cost on a B1 instance. The
 * window is short, and it only ever delays the guard noticing a JUST-completed
 * project by a second — the service-layer check has already refused the
 * user-facing path by then, and the closure transaction itself runs inside the
 * lifecycle bypass.
 */
const CACHE_TTL_MS = 1000;

interface CacheState {
  ids: Set<string>;
  fetchedAt: number;
  inflight: Promise<Set<string>> | null;
}

const cache: CacheState = { ids: new Set(), fetchedAt: 0, inflight: null };

/** Reset the cache — used by tests, and after a closure or reopen. */
export function invalidateClosedProjectCache(): void {
  cache.fetchedAt = 0;
  cache.inflight = null;
}

export async function getClosedSiteIds(
  load: () => Promise<{ id: string }[]>,
): Promise<Set<string>> {
  const now = Date.now();
  if (now - cache.fetchedAt < CACHE_TTL_MS) return cache.ids;
  if (cache.inflight) return cache.inflight;

  cache.inflight = load()
    .then((rows) => {
      cache.ids = new Set(rows.map((r) => r.id));
      cache.fetchedAt = Date.now();
      cache.inflight = null;
      return cache.ids;
    })
    .catch((err) => {
      cache.inflight = null;
      throw err;
    });

  return cache.inflight;
}

/**
 * Pull a site id out of a Prisma write payload.
 *
 * Handles the shapes a create/update actually uses: a scalar `jobSiteId`, or a
 * nested `jobSite: { connect: { id } }` relation.
 */
export function siteIdFromData(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data)) return data.flatMap(siteIdFromData);

  const d = data as Record<string, unknown>;
  const out: string[] = [];

  if (typeof d.jobSiteId === 'string') out.push(d.jobSiteId);

  const rel = d.jobSite as Record<string, unknown> | undefined;
  if (rel && typeof rel === 'object') {
    const connect = rel.connect as Record<string, unknown> | undefined;
    if (connect && typeof connect.id === 'string') out.push(connect.id);
  }

  return out;
}

/** Pull a site id out of a `where` clause, when it names one directly. */
export function siteIdFromWhere(where: unknown): string[] {
  if (!where || typeof where !== 'object') return [];
  const w = where as Record<string, unknown>;
  if (typeof w.jobSiteId === 'string') return [w.jobSiteId];
  // `jobSiteId: { in: [...] }`
  const nested = w.jobSiteId as Record<string, unknown> | undefined;
  if (nested && typeof nested === 'object' && Array.isArray(nested.in)) {
    return nested.in.filter((v): v is string => typeof v === 'string');
  }
  return [];
}
