/**
 * UK mobile phone validation, normalisation and formatting.
 *
 * Accepts the ways a UK worker is likely to type their number:
 *   07700 900123 | 07700900123 | +44 7700 900123 | 447700900123 | 0044 7700…
 * and normalises to E.164 (+447700900123) for sending SMS and for storage.
 *
 * UK mobiles are "07" + 9 digits (the "075"–"079" ranges, plus 071–074), i.e.
 * E.164 "+447" followed by 9 digits. We validate that shape rather than every
 * Ofcom allocation — good enough for v1 and forgiving of spacing/punctuation.
 */

export interface NormalisedMobile {
  ok: boolean;
  /** E.164 form, e.g. +447700900123 — present only when ok is true. */
  e164?: string;
  /** A short, user-facing reason when ok is false. */
  error?: string;
}

/** Strip spaces, hyphens, brackets and a leading "00" international prefix. */
function clean(raw: string): string {
  let value = raw.trim().replace(/[\s()\-.]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  return value;
}

export function normaliseUkMobile(raw: string): NormalisedMobile {
  if (!raw || !raw.trim()) {
    return { ok: false, error: 'Please enter your mobile number.' };
  }

  const value = clean(raw);

  // Reduce the accepted forms to the 10 national digits after the "07"/"+447".
  let national: string | undefined;
  if (/^\+44\d{10}$/.test(value)) {
    national = `0${value.slice(3)}`; // +447xxxxxxxxx -> 07xxxxxxxxx
  } else if (/^44\d{10}$/.test(value)) {
    national = `0${value.slice(2)}`;
  } else if (/^0\d{10}$/.test(value)) {
    national = value;
  }

  if (!national) {
    return {
      ok: false,
      error: 'Enter a valid UK mobile number, e.g. 07700 900123.',
    };
  }

  // Must be a mobile: national format 07 + 9 digits.
  if (!/^07\d{9}$/.test(national)) {
    return {
      ok: false,
      error: 'That doesn’t look like a UK mobile number (it should start 07).',
    };
  }

  return { ok: true, e164: `+44${national.slice(1)}` };
}

/** Format an E.164 UK mobile for friendly display, e.g. "07700 900123". */
export function formatUkMobileForDisplay(e164: string): string {
  const result = normaliseUkMobile(e164);
  if (!result.ok || !result.e164) return e164;
  const national = `0${result.e164.slice(3)}`; // 07700900123
  return `${national.slice(0, 5)} ${national.slice(5)}`;
}

/** Mask a mobile for confirmations, e.g. "+44 7700 ••• 123". */
export function maskUkMobile(e164: string): string {
  const result = normaliseUkMobile(e164);
  if (!result.ok || !result.e164) return e164;
  const d = result.e164; // +447700900123
  return `${d.slice(0, 3)} ${d.slice(3, 7)} ••• ${d.slice(-3)}`;
}
