import { CscsCardType } from '@prisma/client';
import type {
  CscsQualification,
  CscsVerificationResult,
  CscsVerificationStatus,
} from './CscsProvider';

/**
 * SC-001 — Smart Check response mapping layer.
 *
 * The one piece of the CSCS integration that can be built, exercised and proven
 * WITHOUT partner access: turning a Smart Check payload into the platform's own
 * CscsVerificationResult. Kept as a PURE function with no I/O so the whole
 * decision table is testable offline (scripts/sc001_cscs_tests.ts).
 *
 * ── WHAT IS PROVISIONAL, AND WHY IT IS SAFE ───────────────────────────────
 *
 * The CSCS Smart Check API contract is not published openly; it is issued to
 * approved partners. The FIELD NAMES below are therefore inferred, and this
 * mapper is deliberately built to survive being wrong about them:
 *
 *   1. Every field is read through `pick()`, which accepts several plausible
 *      spellings (camelCase, snake_case, and the obvious synonyms). A contract
 *      that uses any of them needs no code change.
 *   2. Nothing is assumed about VALUE spelling either — card status and grade
 *      are matched on normalised substrings, not equality, so "Expired",
 *      "EXPIRED" and "card_expired" all land on the same branch.
 *   3. An unrecognised status maps to ERROR, never to VALID. The failure
 *      direction is deliberate: a card must never be reported as verified
 *      because the payload was not understood.
 *
 * On partner onboarding the work is to confirm the real field names against
 * §"Response fields" of the partner documentation and delete the alternatives
 * that do not apply — not to write this logic.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 *
 * It does not decide `verified`. That is derived from status ALONE (VALID and
 * only VALID), so a payload cannot assert its own trustworthiness.
 */

/** The raw shape as received. Unknown by design — this is someone else's JSON. */
export type SmartCheckPayload = Record<string, unknown>;

/**
 * Read the first present, non-empty value among several candidate keys.
 *
 * Case- and separator-insensitive, and it will look one level into a nested
 * object under common container names, because partner APIs frequently wrap the
 * card record ("card", "data", "result").
 */
function pick(payload: SmartCheckPayload, ...keys: string[]): unknown {
  const containers: SmartCheckPayload[] = [payload];
  for (const c of ['card', 'data', 'result', 'cardDetails', 'card_details']) {
    const nested = payload[c];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      containers.push(nested as SmartCheckPayload);
    }
  }

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = new Set(keys.map(norm));

  for (const container of containers) {
    for (const [k, v] of Object.entries(container)) {
      if (!wanted.has(norm(k))) continue;
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      return v;
    }
  }
  return undefined;
}

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
};

/** Normalised for substring matching: lowercase, alphanumerics only. */
const key = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number'
    ? String(v).toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';

/**
 * A date, as a UTC midnight Date, or null.
 *
 * Accepts ISO (`2027-03-01`, `2027-03-01T00:00:00Z`) and UK `DD/MM/YYYY`, which
 * is what a UK scheme is most likely to emit. UK order is assumed for the
 * slash form deliberately: interpreting 03/04/2027 as 4 March would silently
 * move an expiry by a month, and this is a compliance record.
 */
export function parseSmartCheckDate(raw: unknown): Date | null {
  const s = str(raw);
  if (!s) return null;

  const uk = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (uk) {
    const [, d, m, y] = uk;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

/**
 * Map a Smart Check card grade onto our enum.
 *
 * Matched on colour and role words rather than an exact string, because the
 * scheme's own wording varies ("Blue - Skilled Worker", "Skilled Worker (Blue)",
 * "BLUE_SKILLED"). Returns null when unrecognised — the worker's typed grade
 * then stands, which is better than guessing a competency level.
 */
export function mapCardType(raw: unknown): CscsCardType | null {
  const k = key(raw);
  if (!k) return null;

  // Order matters: check the more specific role words before the colours, so
  // "Gold Supervisor" is not caught by a bare colour match on another field.
  if (k.includes('labour')) return CscsCardType.GREEN_LABOURER;
  if (k.includes('trainee') || k.includes('experiencedworker'))
    return CscsCardType.RED_TRAINEE;
  if (k.includes('skilled')) return CscsCardType.BLUE_SKILLED;
  if (k.includes('supervis') || k.includes('advancedcraft'))
    return CscsCardType.GOLD_SUPERVISORY;
  if (k.includes('manager') || k.includes('management'))
    return CscsCardType.BLACK_MANAGER;
  if (k.includes('professional') || k.includes('academic'))
    return CscsCardType.WHITE_PROFESSIONAL;

  if (k.includes('green')) return CscsCardType.GREEN_LABOURER;
  if (k.includes('red')) return CscsCardType.RED_TRAINEE;
  if (k.includes('blue')) return CscsCardType.BLUE_SKILLED;
  if (k.includes('gold')) return CscsCardType.GOLD_SUPERVISORY;
  if (k.includes('black')) return CscsCardType.BLACK_MANAGER;
  if (k.includes('white')) return CscsCardType.WHITE_PROFESSIONAL;

  return null;
}

/**
 * Map the scheme's card status onto ours.
 *
 * FAILS CLOSED. Anything not recognised becomes ERROR, so an unexpected value
 * can never present as a valid card. Revoked/withdrawn is checked before
 * expiry, and expiry before validity, because a payload may legitimately carry
 * more than one signal and the most serious must win.
 */
export function mapStatus(raw: unknown): CscsVerificationStatus {
  const k = key(raw);
  if (!k) return 'ERROR';

  if (
    k.includes('revoked') ||
    k.includes('withdrawn') ||
    k.includes('suspended') ||
    k.includes('cancelled') ||
    k.includes('canceled')
  ) {
    return 'REVOKED';
  }
  if (k.includes('expired') || k.includes('lapsed')) return 'EXPIRED';
  if (
    k.includes('notfound') ||
    k.includes('nomatch') ||
    k.includes('unknown') ||
    k.includes('nocard')
  ) {
    return 'NOT_FOUND';
  }
  if (k.includes('valid') || k.includes('active') || k.includes('current')) {
    // "invalid" contains "valid" — guard it explicitly rather than relying on
    // ordering, because that dependency is invisible to the next reader.
    if (k.includes('invalid')) return 'NOT_FOUND';
    return 'VALID';
  }
  return 'ERROR';
}

/** Qualifications, from any of the shapes a list of competencies might take. */
export function mapQualifications(raw: unknown): CscsQualification[] {
  if (!Array.isArray(raw)) return [];
  const out: CscsQualification[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry.trim()) out.push({ title: entry.trim() });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as SmartCheckPayload;
    const title =
      str(pick(o, 'title', 'name', 'qualification', 'description')) ?? null;
    if (!title) continue;
    const detail =
      str(pick(o, 'detail', 'details', 'level', 'grade', 'awardingBody')) ??
      undefined;
    out.push(detail ? { title, detail } : { title });
  }
  return out;
}

/** Human-readable summary per status. Safe to show a worker. */
export function messageForStatus(
  status: CscsVerificationStatus,
  expiry: Date | null,
): string {
  switch (status) {
    case 'VALID':
      return expiry
        ? `Card verified with CSCS Smart Check. Valid until ${expiry
            .toISOString()
            .slice(0, 10)
            .split('-')
            .reverse()
            .join('/')}.`
        : 'Card verified with CSCS Smart Check.';
    case 'EXPIRED':
      return 'This card is recorded as expired. Please renew it and update your details.';
    case 'REVOKED':
      return 'This card is recorded as withdrawn. Contact the card scheme before working on site.';
    case 'NOT_FOUND':
      return 'No matching card was found. Check the number and try again.';
    case 'UNVERIFIED':
      return 'No card number supplied.';
    case 'ERROR':
    default:
      return 'The CSCS Smart Check service could not complete this check. Your details have been saved and can be verified later.';
  }
}

/**
 * Map a Smart Check payload onto a CscsVerificationResult.
 *
 * `verified` is derived from status alone. An expiry in the past DOWNGRADES a
 * VALID status to EXPIRED — a scheme that reports a card as active while its
 * own expiry date has passed should not produce a verified competency record,
 * and reconciling that here means the disagreement is resolved once rather than
 * at every call site.
 */
export function mapSmartCheckResponse(
  payload: SmartCheckPayload,
  providerName: string,
  checkedAt: Date = new Date(),
): CscsVerificationResult {
  const rawStatus = pick(
    payload,
    'status',
    'cardStatus',
    'verificationStatus',
    'result',
    'outcome',
  );
  let status = mapStatus(rawStatus);

  const expiry = parseSmartCheckDate(
    pick(payload, 'expiry', 'expiryDate', 'expiresOn', 'validTo', 'endDate'),
  );

  if (status === 'VALID' && expiry) {
    const today = new Date(
      Date.UTC(
        checkedAt.getUTCFullYear(),
        checkedAt.getUTCMonth(),
        checkedAt.getUTCDate(),
      ),
    );
    if (expiry.getTime() < today.getTime()) status = 'EXPIRED';
  }

  const scheme = str(
    pick(payload, 'scheme', 'schemeName', 'cardScheme', 'partnerScheme'),
  );
  const holderName = str(
    pick(payload, 'holderName', 'name', 'cardHolder', 'cardHolderName', 'holder'),
  );
  const cardType = mapCardType(
    pick(payload, 'cardType', 'cardGrade', 'grade', 'type', 'occupation'),
  );
  const qualifications = mapQualifications(
    pick(payload, 'qualifications', 'competencies', 'skills', 'occupations'),
  );

  return {
    status,
    // Derived from status ALONE — never from a field in the payload.
    verified: status === 'VALID',
    scheme,
    cardType,
    holderName,
    expiry,
    qualifications: qualifications.length > 0 ? qualifications : undefined,
    providerName,
    checkedAt,
    message: messageForStatus(status, expiry),
  };
}
