/**
 * BL-001 — how a manual check-out is described, in one place.
 *
 * The flag has to be visible EVERYWHERE the check-out appears: the check-ins
 * rail, worker history, the attendance report, both CSV exports and the
 * close-out pack. A forced check-out that looked like a genuine one would be
 * worse than none, because it would silently corrupt the attendance record
 * rather than annotate it — so the wording lives here and every surface reads
 * it, instead of each inventing its own.
 */

/** The subset of a submission any surface needs to describe the close. */
export interface ManualCheckOutFields {
  checkedOutManual: boolean;
  checkedOutByName: string | null;
  checkedOutByRole: string | null;
  checkedOutReason: string | null;
}

/** "Site Manager Test (Site Manager)" — actor and the role they held at the time. */
export function manualActorLabel(row: ManualCheckOutFields): string {
  const name = row.checkedOutByName?.trim() || 'Unknown user';
  const role = roleLabel(row.checkedOutByRole);
  return role ? `${name} (${role})` : name;
}

/** Human role label from the stored enum value. */
export function roleLabel(role: string | null): string {
  if (!role) return '';
  return role
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** One line for a CSV cell or a plain-text pack: actor, role and reason. */
export function manualCheckOutSummary(row: ManualCheckOutFields): string {
  if (!row.checkedOutManual) return '';
  const reason = row.checkedOutReason?.trim();
  return reason
    ? `${manualActorLabel(row)} — ${reason}`
    : manualActorLabel(row);
}

/**
 * Time on site is NOT reported for a manual close.
 *
 * `checkedOutAt` is the moment a manager acted, not when the worker left, so the
 * difference between the two timestamps is not a shift length. Publishing it
 * would put a fabricated duration — sometimes weeks — into attendance reporting.
 */
export function durationIsMeaningful(row: { checkedOutManual: boolean }): boolean {
  return !row.checkedOutManual;
}

/**
 * Whole days a check-in has been open. Shown beside the override control so the
 * decision is made with the age in view — a record open for an hour and one open
 * for five weeks warrant very different confidence.
 */
export function daysOpen(checkedInAt: Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - checkedInAt.getTime()) / 86_400_000),
  );
}
