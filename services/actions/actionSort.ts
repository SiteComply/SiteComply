/**
 * Actions table sorting — pure, client-safe helpers (no Prisma/server imports)
 * so the page and any test share one source of truth.
 *
 * Deliberately mirrors services/submissions/checkinSort.ts rather than sharing
 * with it yet. With two real implementations in hand the common shape is now
 * obvious and worth extracting into lib/; extracting it from one example would
 * have been a guess about the second.
 *
 * Sorting is applied inside the viewer's already-scoped query, so it reorders a
 * set the `where` has constrained and can never widen access.
 */

export type ActionSortKey = 'action' | 'state' | 'due' | 'assigned';
export type ActionSortDir = 'asc' | 'desc';

export interface ActionSort {
  key: ActionSortKey;
  dir: ActionSortDir;
}

const KEYS: readonly ActionSortKey[] = ['action', 'state', 'due', 'assigned'];

/**
 * First-click direction per column.
 *
 * Everything here ascends on first click, including Due — because for this
 * table ascending IS the useful direction: soonest first answers "what is due
 * next", which is the question the screen exists for. That is also the order
 * the table has always opened on, so the default is unchanged by this feature.
 */
export function defaultDirFor(_key: ActionSortKey): ActionSortDir {
  return 'asc';
}

/** What the table opens on with no sort in the URL — the long-standing order. */
export const DEFAULT_ACTION_SORT: ActionSort = { key: 'due', dir: 'asc' };

export function isDefaultSort(sort: ActionSort): boolean {
  return (
    sort.key === DEFAULT_ACTION_SORT.key && sort.dir === DEFAULT_ACTION_SORT.dir
  );
}

/** Parse raw `?sort` / `?dir`; anything unrecognised falls back safely. */
export function parseActionSort(rawKey?: string, rawDir?: string): ActionSort {
  const k = (rawKey ?? '').trim() as ActionSortKey;
  const key = KEYS.includes(k) ? k : DEFAULT_ACTION_SORT.key;
  const d = (rawDir ?? '').trim().toLowerCase();
  const dir: ActionSortDir = d === 'asc' || d === 'desc' ? d : defaultDirFor(key);
  return { key, dir };
}

/** Active column reverses; any other column starts at its default direction. */
export function nextSortFor(key: ActionSortKey, current: ActionSort): ActionSort {
  if (current.key !== key) return { key, dir: defaultDirFor(key) };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/** Omitted when default, so the plain URL stays clean and bookmarkable. */
export function actionSortParams(sort: ActionSort): { sort?: string; dir?: string } {
  if (isDefaultSort(sort)) return {};
  return { sort: sort.key, dir: sort.dir };
}

export type ActionOrderBy = Record<string, unknown>[];

/**
 * The Prisma `orderBy` for a sort. Three things here are deliberate.
 *
 * 1. THE `id` TIEBREAKER ON EVERY BRANCH, for the reason set out in
 *    services/actions/actionService.ts: without a unique last key, paging a
 *    tied ordering can show a row twice and another not at all.
 *
 * 2. NULLS LAST ON BOTH NULLABLE COLUMNS, IN BOTH DIRECTIONS. `dueDate` and
 *    `assignedTo` are optional, and Postgres would otherwise put nulls last
 *    ascending but FIRST descending. Reversing "Due" would then lead with every
 *    undated action — the rows carrying the least information pushed to the top
 *    of a list about what happens next. Unassigned work sorts to the end for the
 *    same reason. It is a judgement, not a technical necessity: if unassigned
 *    actions should instead surface first, this is the one line to change.
 *
 * 3. `state` SORTS THE ENUM, WHICH IS DECLARATION ORDER, NOT ALPHABETICAL.
 *    ActionStatus is declared OPEN, IN_PROGRESS, COMPLETED, so ascending runs
 *    open work first and finished work last. That is the lifecycle order and
 *    the useful one; it is luck that it also matches the declaration, so if the
 *    enum is ever reordered this sort changes meaning with it.
 */
export function actionOrderBy(sort: ActionSort): ActionOrderBy {
  const dir = sort.dir;
  const tiebreak = { id: 'asc' as const };

  switch (sort.key) {
    case 'action':
      return [{ title: dir }, tiebreak];
    case 'state':
      return [{ status: dir }, tiebreak];
    case 'assigned':
      return [{ assignedTo: { sort: dir, nulls: 'last' } }, tiebreak];
    case 'due':
    default:
      // `createdAt desc` is kept as the secondary key so the default ordering is
      // byte-for-byte what this table showed before sorting existed.
      return [
        { dueDate: { sort: dir, nulls: 'last' } },
        { createdAt: 'desc' },
        tiebreak,
      ];
  }
}

/** Column headings, in table order, with the key each one sorts by. */
export const ACTION_COLUMNS: { key: ActionSortKey; label: string }[] = [
  { key: 'action', label: 'Action' },
  { key: 'state', label: 'State' },
  { key: 'due', label: 'Due' },
  { key: 'assigned', label: 'Assigned' },
];
