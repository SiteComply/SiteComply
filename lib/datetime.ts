/**
 * British date & time formatting helpers.
 *
 * Everything is stored in UTC; these format for display in UK conventions:
 *   - dates as DD/MM/YYYY
 *   - times as 24-hour HH:mm
 *   - all in the Europe/London timezone (correctly handling GMT/BST)
 *
 * Implemented with Intl so daylight-saving is handled by the platform rather
 * than by hand.
 */
import { appConfig } from './config';

const TZ = appConfig.timeZone; // 'Europe/London'
const LOCALE = appConfig.locale; // 'en-GB'

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** e.g. 25/06/2026 */
export function formatDateUK(value: Date | string | number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(toDate(value));
}

/** e.g. 14:30 (24-hour) */
export function formatTimeUK(value: Date | string | number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(toDate(value));
}

/** e.g. 25/06/2026 14:30 */
export function formatDateTimeUK(value: Date | string | number): string {
  return `${formatDateUK(value)} ${formatTimeUK(value)}`;
}

/**
 * The UTC instant of midnight (start of day) in Europe/London for a given
 * yyyy-mm-dd. Uses the standard offset trick so GMT/BST are handled correctly
 * (e.g. 14/06 00:00 BST = 13/06 23:00 UTC). For date-range filtering.
 */
export function zonedMidnightToUtc(yyyyMmDd: string): Date {
  const utcGuess = new Date(`${yyyyMmDd}T00:00:00Z`);
  // What wall-clock time is utcGuess in London? Re-parse that as if it were UTC.
  const londonWall = new Date(
    utcGuess.toLocaleString('en-US', { timeZone: TZ }),
  );
  const utcWall = new Date(
    utcGuess.toLocaleString('en-US', { timeZone: 'UTC' }),
  );
  const offsetMs = utcWall.getTime() - londonWall.getTime();
  return new Date(utcGuess.getTime() + offsetMs);
}

/** Add whole days to a yyyy-mm-dd string (calendar arithmetic, tz-agnostic). */
export function addDaysToDateStr(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Build a UTC [gte, lt) range from inclusive UK local from/to dates
 * (yyyy-mm-dd). Either end may be omitted. `lt` is the start of the day after
 * `to`, so the whole of the `to` day is included.
 */
export function ukDateRangeToUtc(
  from?: string,
  to?: string,
): {
  gte?: Date;
  lt?: Date;
} {
  const range: { gte?: Date; lt?: Date } = {};
  if (from) range.gte = zonedMidnightToUtc(from);
  if (to) range.lt = zonedMidnightToUtc(addDaysToDateStr(to, 1));
  return range;
}

/**
 * Convert a date to the yyyy-mm-dd value an <input type="date"> expects,
 * evaluated in Europe/London. Returns '' for nullish input.
 */
export function toDateInputValue(
  value: Date | string | number | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  // en-CA renders ISO-like yyyy-mm-dd, which is exactly the input format.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(toDate(value));
}
