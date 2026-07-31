import { zonedMidnightToUtc } from '@/lib/datetime';

/**
 * SC-023 Phase 2 — the access window. PURE, and deliberately its own module so
 * the boundary arithmetic is testable without a database.
 *
 * THE RULE: `endDate` is INCLUSIVE. Access runs to the END of that day in
 * Europe/London. A manager who types 12 September means "they can work on the
 * 12th", not "their access dies at midnight as the 12th begins".
 *
 * Both dates are stored as the UTC instant of London midnight for the chosen
 * day, matching how SC-020 stores compliance dates, so DST never shifts a
 * boundary by an hour.
 *
 * SC-020 Phase 3 lost a day to an exclusive upper bound. The whole point of
 * putting this in one small file is that the comparison lives in exactly one
 * place.
 */

export type WindowState = 'active' | 'pending' | 'expired' | 'none';

/** Convert a yyyy-mm-dd form value to the stored instant, or null if blank. */
export function parseAccessDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  return zonedMidnightToUtc(value);
}

/** The instant access stops: the END of the endDate day, London. */
export function endOfAccess(endDate: Date): Date {
  // Midnight at the START of the following day. Computed by adding a day to the
  // stored midnight rather than by adding 23:59:59, so a DST transition inside
  // that day cannot make the window an hour short or an hour long.
  return new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Where `now` sits relative to the window.
 *
 * Derived on every read rather than stored as a status. Expiry is a STATE, not
 * an event — the SC-016/SC-020 rule — so there is no job to run, nothing to
 * fall out of step, and no window where a flag and a date disagree.
 */
export function windowState(
  startDate: Date | null,
  endDate: Date | null,
  now: Date = new Date(),
): WindowState {
  if (!startDate && !endDate) return 'none';
  if (startDate && now.getTime() < startDate.getTime()) return 'pending';
  if (endDate && now.getTime() >= endOfAccess(endDate).getTime()) {
    return 'expired';
  }
  return 'active';
}

/** Days until access ends, or null when there is no end date. */
export function daysUntilExpiry(
  endDate: Date | null,
  now: Date = new Date(),
): number | null {
  if (!endDate) return null;
  const ms = endOfAccess(endDate).getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** Expiring soon enough that a manager should act before it bites at the gate. */
export const EXPIRY_WARNING_DAYS = 7;

export function isExpiringSoon(
  endDate: Date | null,
  now: Date = new Date(),
): boolean {
  const days = daysUntilExpiry(endDate, now);
  return days !== null && days > 0 && days <= EXPIRY_WARNING_DAYS;
}
