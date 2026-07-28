/**
 * Client-safe Digital Induction Acceptance constants (SC-011). Shared by the
 * Accept & Sign UI and the server, so the declaration the worker signs is exactly
 * the wording snapshotted onto their record. No Prisma/server imports.
 */

/**
 * The declaration a worker confirms before signing. Presented in full on the
 * Accept & Sign screen and snapshotted onto the signed record (declarationText)
 * so the evidence captures precisely what was agreed to.
 */
export const INDUCTION_DECLARATION =
  'I confirm that I have read, understood and agree to comply with all site rules, ' +
  'safety requirements and procedures outlined in this induction. I understand that ' +
  'it is my responsibility to ask if I am unsure about anything, and to report any ' +
  'hazards or concerns to site management.';

export type SignatureTypeValue = 'DRAWN' | 'TYPED';

export const SIGNED_NAME_MAX = 120;

/** Max accepted drawn-signature PNG size (base64-decoded bytes). */
export const SIGNATURE_MAX_BYTES = 500 * 1024; // 500 KB — a canvas PNG is far smaller
