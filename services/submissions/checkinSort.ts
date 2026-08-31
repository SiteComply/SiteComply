/**
 * Check-ins table sorting — pure, client-safe helpers (no Prisma/server
 * imports) so the page, the export route and any test share one source of
 * truth. Mirrors the shape of ./checkinFilter.ts.
 *
 * Sorting is applied INSIDE the viewer's already site-scoped query. It reorders
 * a result set the `where` clause has constrained to `viewer.siteIds`; it can
 * never widen access, for the same reason paging cannot.
 *
 * This is the reference implementation for sortable tables. If it is copied to
 * Actions, Audits, Documents or Permits, copy the tiebreaker rule with it —
 * that is the part that is easy to leave out and expensive to debug.
 */

export type CheckinSortKey = 'worker' | 'site' | 'status' | 'checkedIn';
export type CheckinSortDir = 'asc' | 'desc';

export interface CheckinSort {
  key: CheckinSortKey;
  dir: CheckinSortDir;
}

const KEYS: readonly CheckinSortKey[] = ['worker', 'site', 'status', 'checkedIn'];

/**
 * The direction a column sorts on its FIRST click. Text reads naturally A→Z,
 * but a date column whose first click showed the oldest records would bury the
 * newest — and newest-first is what this table has always opened on.
 */
export function defaultDirFor(key: CheckinSortKey): CheckinSortDir {
  return key === 'checkedIn' ? 'desc' : 'asc';
}

/** What the table opens on when no sort is in the URL — the previous behaviour. */
export const DEFAULT_CHECKIN_SORT: CheckinSort = {
  key: 'checkedIn',
  dir: 'desc',
};

export function isDefaultSort(sort: CheckinSort): boolean {
  return (
    sort.key === DEFAULT_CHECKIN_SORT.key && sort.dir === DEFAULT_CHECKIN_SORT.dir
  );
}

/** Parse raw `?sort` / `?dir` values; anything unrecognised falls back safely. */
export function parseCheckinSort(
  rawKey?: string,
  rawDir?: string,
): CheckinSort {
  const k = (rawKey ?? '').trim() as CheckinSortKey;
  const key = KEYS.includes(k) ? k : DEFAULT_CHECKIN_SORT.key;
  const d = (rawDir ?? '').trim().toLowerCase();
  const dir: CheckinSortDir =
    d === 'asc' || d === 'desc' ? d : defaultDirFor(key);
  return { key, dir };
}

/**
 * What clicking a header should do: the active column reverses, any other
 * column starts at its own default direction.
 *
 * There is deliberately no third state returning to "unsorted". The table is
 * always in some order, so an unsorted state would be indistinguishable from
 * the default one — a click that appears to do nothing.
 */
export function nextSortFor(key: CheckinSortKey, current: CheckinSort): CheckinSort {
  if (current.key !== key) return { key, dir: defaultDirFor(key) };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * Sort params for a URL, omitted entirely when the sort is the default so the
 * plain `/submissions` link stays clean and bookmarkable — the same convention
 * the status filter already uses.
 */
export function checkinSortParams(
  sort: CheckinSort,
): { sort?: string; dir?: string } {
  if (isDefaultSort(sort)) return {};
  return { sort: sort.key, dir: sort.dir };
}

/**
 * The Prisma `orderBy` for a sort. Shaped as plain objects so this file stays
 * free of server imports; the service passes it straight through.
 *
 * TWO THINGS HERE ARE LOAD-BEARING.
 *
 * 1. THE `id` TIEBREAKER, ON EVERY BRANCH. Sorting by Status orders the whole
 *    table on a key with TWO distinct values. Postgres may return tied rows in
 *    any order it likes, and it is free to choose differently on each query —
 *    so with `skip`/`take` paging over a tied set, some rows would appear on two
 *    pages and others on none. It is invisible on page one and only shows up
 *    under paging, which is exactly the kind of bug that ships. `id` is unique,
 *    so appending it makes every ordering total and therefore stable.
 *
 * 2. STATUS IS `checkedOutAt`, NOT `status`. `Submission.status` exists and is
 *    a SubmissionStatus enum (COMPLIANT / INCOMPLETE) describing the INDUCTION,
 *    not whether the worker is on site. The table's Status column is derived —
 *    on site while `checkedOutAt` is null, checked out once it is set — so the
 *    sort orders on null-ness. Ascending puts nulls first, which groups "On
 *    site" at the top; descending puts them last. Sorting on `status` would
 *    produce an ordering that has nothing to do with the labels on screen.
 */
export type CheckinOrderBy = Record<string, unknown>[];

export function checkinOrderBy(sort: CheckinSort): CheckinOrderBy {
  const dir = sort.dir;
  const tiebreak = { id: 'asc' as const };

  switch (sort.key) {
    case 'worker':
      return [{ worker: { fullName: dir } }, tiebreak];
    case 'site':
      return [{ jobSite: { name: dir } }, tiebreak];
    case 'status':
      // Within each group the rows then fall in check-out order, which is a
      // useful side effect rather than the point.
      return [
        { checkedOutAt: { sort: dir, nulls: dir === 'asc' ? 'first' : 'last' } },
        tiebreak,
      ];
    case 'checkedIn':
    default:
      return [{ checkedInAt: dir }, tiebreak];
  }
}

/** Column headings, in table order, with the key each one sorts by. */
export const CHECKIN_COLUMNS: { key: CheckinSortKey; label: string }[] = [
  { key: 'worker', label: 'Worker' },
  { key: 'site', label: 'Site' },
  { key: 'status', label: 'Status' },
  { key: 'checkedIn', label: 'Checked in' },
];
