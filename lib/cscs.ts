import { CscsCardType } from '@prisma/client';

/**
 * Friendly UK labels for CSCS (Construction Skills Certification Scheme) card
 * types, keyed by the Prisma enum. Used in the worker identity step and the
 * admin views so the card colour/grade reads naturally.
 */
export const CSCS_CARD_LABELS: Record<CscsCardType, string> = {
  GREEN_LABOURER: 'Green — Labourer',
  RED_TRAINEE: 'Red — Trainee / Experienced Worker',
  BLUE_SKILLED: 'Blue — Skilled Worker',
  GOLD_SUPERVISORY: 'Gold — Advanced Craft / Supervisory',
  BLACK_MANAGER: 'Black — Manager',
  WHITE_PROFESSIONAL: 'White — Professionally / Academically Qualified',
};

/** Ordered list for rendering a select, most common first. */
export const CSCS_CARD_OPTIONS: { value: CscsCardType; label: string }[] = [
  CscsCardType.GREEN_LABOURER,
  CscsCardType.BLUE_SKILLED,
  CscsCardType.GOLD_SUPERVISORY,
  CscsCardType.RED_TRAINEE,
  CscsCardType.BLACK_MANAGER,
  CscsCardType.WHITE_PROFESSIONAL,
].map((value) => ({ value, label: CSCS_CARD_LABELS[value] }));

/**
 * Normalise a card number for storage/lookup. CSCS Alliance cards use numerical
 * numbers; some partner schemes (e.g. ECS) use alphanumeric references — so we
 * keep letters, digits and dashes, upper-case them and drop spaces/punctuation.
 */
export function normaliseCscsCardNumber(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '');
}

/**
 * Accept both numerical and alphanumeric card numbers (SC-001). Once normalised,
 * a plausible card number is 4–20 characters of letters/digits/dashes.
 */
export function isValidCscsCardNumber(raw: string): boolean {
  const n = normaliseCscsCardNumber(raw);
  return /^[A-Z0-9-]{4,20}$/.test(n);
}

/** Human-readable labels for the Smart Check verification statuses. */
export const CSCS_VERIFICATION_LABELS: Record<string, string> = {
  VALID: 'Verified',
  EXPIRED: 'Card expired',
  REVOKED: 'Card revoked',
  NOT_FOUND: 'Not found',
  ERROR: 'Could not verify',
  UNVERIFIED: 'Not verified',
};

/** Friendly label for a stored verification status (falls back to the raw value). */
export function cscsVerificationLabel(
  status: string | null | undefined,
): string {
  if (!status) return CSCS_VERIFICATION_LABELS.UNVERIFIED;
  return CSCS_VERIFICATION_LABELS[status] ?? status;
}
