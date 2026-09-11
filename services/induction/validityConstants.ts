/**
 * Client-safe constants for induction validity (SC-006). Kept free of Prisma /
 * server imports (mirrors ../knowledgeChecks/knowledgeCheckConstants) so the
 * worker UI, the site-manager config UI and the server services share one source
 * of truth.
 */

/** Preset validity periods (in days). Custom is any positive integer of days. */
export const VALIDITY_PRESETS: { label: string; days: number }[] = [
  { label: '1 day', days: 1 },
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 91 },
  { label: '6 months', days: 182 },
  { label: '12 months', days: 365 },
];

/**
 * The platform standard, applied to every NEW site at creation.
 *
 * 91 rather than 90: the existing presets are quarters of a year (182 is half of
 * 365, not six lots of 30), so a quarter is 91.
 *
 * Deliberately NOT implemented as a fallback for a null value. `null` already
 * means "re-induct on every check-in" and the site config UI offers it as an
 * explicit radio button — reading null as 91 would make that option impossible
 * to choose, because saving it would immediately read back as three months. New
 * sites get the standard written as a real value instead, which keeps the two
 * states distinguishable.
 */
export const DEFAULT_INDUCTION_VALIDITY_DAYS = 91;

/** Bounds for a custom validity period. */
export const VALIDITY_MIN_DAYS = 1;
export const VALIDITY_MAX_DAYS = 3650; // 10 years

/**
 * A human label for a stored validity (days). null → re-induct every check-in.
 * Falls back to "N days" for a custom value that isn't a preset.
 */
export function validityLabel(days: number | null | undefined): string {
  if (days == null) return 'Every check-in';
  const preset = VALIDITY_PRESETS.find((p) => p.days === days);
  if (preset) return preset.label;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Clamp a custom day count into the allowed range (or null to clear). */
export function clampValidityDays(
  days: number | null | undefined,
): number | null {
  if (days == null) return null;
  if (!Number.isInteger(days) || days <= 0) return null;
  return Math.min(Math.max(days, VALIDITY_MIN_DAYS), VALIDITY_MAX_DAYS);
}
