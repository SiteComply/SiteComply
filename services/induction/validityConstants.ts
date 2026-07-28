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
  { label: '6 months', days: 182 },
  { label: '12 months', days: 365 },
];

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
