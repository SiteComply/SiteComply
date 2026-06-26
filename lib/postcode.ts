/**
 * UK postcode validation and normalisation.
 *
 * Accepts postcodes with or without the internal space and in any case, and
 * normalises to the canonical uppercase form with a single space before the
 * three-character inward code (e.g. "bs16ag" → "BS1 6AG"). Validates against the
 * standard UK postcode shape (including the GIR 0AA special case).
 */

// Outward + inward, allowing an optional space; case-insensitive.
const UK_POSTCODE =
  /^(GIR ?0AA|(?:[A-Z][0-9]{1,2}|[A-Z][A-HJ-Y][0-9]{1,2}|[A-Z][0-9][A-Z]|[A-Z][A-HJ-Y][0-9][A-Z]) ?[0-9][A-Z]{2})$/i;

export interface NormalisedPostcode {
  ok: boolean;
  postcode?: string; // canonical e.g. "BS1 6AG"
  error?: string;
}

export function normaliseUkPostcode(raw: string): NormalisedPostcode {
  const value = (raw ?? '').trim();
  if (!value) return { ok: false, error: 'Please enter a postcode.' };

  if (!UK_POSTCODE.test(value)) {
    return { ok: false, error: 'Enter a valid UK postcode, e.g. BS1 6AG.' };
  }

  const compact = value.toUpperCase().replace(/\s+/g, '');
  // Inward code is always the final three characters; everything else is outward.
  const formatted = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  return { ok: true, postcode: formatted };
}
