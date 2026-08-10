import type { SmartCheckPayload } from './smartCheckMapper';

/**
 * SC-001 — representative Smart Check responses.
 *
 * These are the payloads the mapper is proven against. They are FIXTURES, not
 * recordings: no live response has been seen, and each one is written to probe
 * a decision the mapper has to make rather than to imitate a real card.
 *
 * They deliberately vary field naming and casing between fixtures — camelCase
 * in one, snake_case in another, nested under `card` in a third — because the
 * partner contract is unknown and the mapper's tolerance of that is the thing
 * most worth testing before credentials arrive.
 *
 * On partner onboarding these become the regression suite: replace the field
 * names with the real ones, and any mapping that silently changes behaviour
 * fails here rather than in production.
 */

export const FIXTURES: Record<string, SmartCheckPayload> = {
  /** Flat camelCase, fully populated. */
  validSkilledCamel: {
    status: 'VALID',
    scheme: 'CSCS',
    cardType: 'Blue - Skilled Worker',
    holderName: 'A. Worker',
    expiry: '2030-03-01',
    qualifications: [
      { title: 'NVQ Level 2 Bricklaying', detail: 'CITB' },
      { title: 'Health & Safety Test', detail: 'Operative' },
    ],
  },

  /** snake_case, nested under `card`, UK date format. */
  validManagerSnakeNested: {
    card: {
      card_status: 'Active',
      scheme_name: 'CSCS',
      card_grade: 'Black — Manager',
      card_holder_name: 'B. Manager',
      expiry_date: '01/06/2029',
      competencies: ['NVQ Level 6 Construction Management'],
    },
  },

  /** ECS scheme, grade expressed as a bare colour. */
  validEcsColourOnly: {
    status: 'current',
    scheme: 'ECS',
    grade: 'Gold',
    name: 'C. Sparks',
    validTo: '2028-12-31',
  },

  /** Explicitly expired. */
  expired: {
    status: 'Expired',
    scheme: 'CSCS',
    cardType: 'Green - Labourer',
    holderName: 'D. Lapsed',
    expiryDate: '2020-01-31',
  },

  /**
   * Says VALID but the expiry has passed. The mapper must downgrade — a scheme
   * disagreeing with itself must not produce a verified competency record.
   */
  validButExpiredDate: {
    status: 'VALID',
    scheme: 'CSCS',
    cardType: 'Blue - Skilled Worker',
    holderName: 'E. Contradiction',
    expiry: '2019-05-05',
  },

  /** Withdrawn / revoked. */
  revoked: {
    status: 'Withdrawn',
    scheme: 'CSCS',
    holderName: 'F. Revoked',
  },

  /** No such card. */
  notFound: { status: 'No match found' },

  /** "invalid" must not be caught by the "valid" substring. */
  invalidWord: { status: 'Invalid card' },

  /** A status nobody has seen before — must fail closed to ERROR. */
  unknownStatus: { status: 'PENDING_REVIEW', scheme: 'CSCS' },

  /** Status missing entirely — must fail closed to ERROR. */
  emptyPayload: {},

  /** Qualifications as plain strings rather than objects. */
  qualificationsAsStrings: {
    status: 'VALID',
    scheme: 'CSCS',
    cardType: 'Red - Trainee',
    holderName: 'G. Trainee',
    expiry: '2031-01-01',
    skills: ['SSSTS', 'Asbestos Awareness'],
  },

  /** Wrapped under `data`, a common envelope. */
  wrappedInData: {
    data: {
      status: 'VALID',
      scheme: 'ECS',
      cardType: 'White — Professionally Qualified Person',
      holderName: 'H. Professional',
      expiry: '2032-07-15',
    },
  },
};
