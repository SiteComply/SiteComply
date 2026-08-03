/**
 * The agreed order for a merged list of outstanding work:
 *
 *   1. Overdue      (past its due date)
 *   2. Due today
 *   3. Due date     (soonest first; undated last)
 *   4. Priority     (highest first)
 *
 * WHY THIS IS A MODULE AND NOT AN INLINE `.sort()`. Site → Compliance is about
 * to merge two lists that each had their own order (audits by status then age,
 * actions by due date then priority). A merged list needs ONE agreed order, and
 * once it is agreed it must be the same everywhere it is shown, or two screens
 * will disagree about what is most urgent. This lives in `components/` because
 * it is presentation ordering of already-loaded, already-authorised rows —
 * `services/` is frozen for the refresh and this changes no query.
 *
 * Purity matters: no `Date.now()` inside. The caller passes `now`, so the order
 * is testable and two panels rendered in the same request cannot straddle
 * midnight and disagree.
 *
 * NOTE ON PERMISSIONS: merging lists must never merge permissions. Callers build
 * the input array from sources they have ALREADY gated separately — a viewer
 * with actions:view but not audits:view passes only actions, and the merged list
 * shows no sign that audit rows were filtered out.
 */

/** Priority ranking, highest urgency first. Mirrors the ActionPriority enum. */
const PRIORITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export interface OutstandingWorkRow {
  id: string;
  /** Null for work with no due date — always sorts last within its bucket. */
  dueDate: Date | null;
  /** Optional; rows without one rank below every row that has one. */
  priority?: string | null;
}

/** London-day equality, so "due today" means the user's today, not UTC's. */
function londonDayKey(d: Date): string {
  return d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
}

export type UrgencyBucket = 'overdue' | 'due-today' | 'upcoming' | 'undated';

/**
 * Which urgency bucket a row falls in. Exported because the UI labels the
 * buckets, and a label derived separately from the sort would eventually
 * disagree with it.
 */
export function urgencyBucket(
  row: OutstandingWorkRow,
  now: Date,
): UrgencyBucket {
  if (!row.dueDate) return 'undated';
  const today = londonDayKey(now);
  const due = londonDayKey(row.dueDate);
  if (due === today) return 'due-today';
  return row.dueDate < now ? 'overdue' : 'upcoming';
}

const BUCKET_RANK: Record<UrgencyBucket, number> = {
  overdue: 0,
  'due-today': 1,
  upcoming: 2,
  undated: 3,
};

/**
 * Compare two rows for the merged outstanding-work list.
 *
 * Total and stable: every tie falls through to the id, so the same input always
 * renders in the same order rather than shuffling between requests.
 */
export function compareOutstandingWork(
  a: OutstandingWorkRow,
  b: OutstandingWorkRow,
  now: Date,
): number {
  const bucketDiff =
    BUCKET_RANK[urgencyBucket(a, now)] - BUCKET_RANK[urgencyBucket(b, now)];
  if (bucketDiff !== 0) return bucketDiff;

  // Within a bucket: soonest due first. Undated rows have no date to compare.
  if (a.dueDate && b.dueDate) {
    const dateDiff = a.dueDate.getTime() - b.dueDate.getTime();
    if (dateDiff !== 0) return dateDiff;
  }

  const ap = a.priority ? (PRIORITY_RANK[a.priority] ?? 99) : 99;
  const bp = b.priority ? (PRIORITY_RANK[b.priority] ?? 99) : 99;
  if (ap !== bp) return ap - bp;

  return a.id.localeCompare(b.id);
}

/** Sort a copy — never mutates the caller's array. */
export function sortOutstandingWork<T extends OutstandingWorkRow>(
  rows: T[],
  now: Date,
): T[] {
  return [...rows].sort((a, b) => compareOutstandingWork(a, b, now));
}
