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
