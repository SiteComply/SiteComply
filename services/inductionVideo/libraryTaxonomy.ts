/**
 * WHAT A LIBRARY VIDEO IS ABOUT, AND WHERE IT CAME FROM, in words.
 *
 * Two axes, deliberately separate from placement. Placement answers "when does an
 * operative see this"; category answers "what is it about". A manager looking for
 * the PPE video should not have to know which band it plays in.
 *
 * No Prisma: both tiers' client components read these.
 */

export const LIBRARY_CATEGORIES = [
  { key: 'COMPANY_CULTURE', label: 'Company & culture',
    hint: 'Who we are and how we work — a company introduction belongs here.' },
  { key: 'PPE', label: 'PPE', hint: 'What must be worn, and why.' },
  { key: 'BEHAVIOUR', label: 'Behaviour & conduct',
    hint: 'Behavioural standards, how people treat each other on site.' },
  { key: 'MANUAL_HANDLING', label: 'Manual handling', hint: 'Lifting, carrying, moving loads.' },
  { key: 'HOUSEKEEPING', label: 'Housekeeping', hint: 'Tidiness, storage, keeping routes clear.' },
  { key: 'ENVIRONMENT', label: 'Environmental awareness',
    hint: 'Waste, spills, noise, protected species and surroundings.' },
  { key: 'REPORTING', label: 'Reporting', hint: 'Near misses, incidents, speaking up.' },
  { key: 'OTHER', label: 'Other', hint: 'Anything that does not fit the list above.' },
] as const;

export type LibraryCategoryKey = (typeof LIBRARY_CATEGORIES)[number]['key'];

export function categoryLabel(key: string): string {
  return LIBRARY_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export const LIBRARY_PROVENANCE = [
  {
    key: 'UPLOADED',
    label: 'Uploaded',
    /** Said in the UI wherever an asset's editability is not obvious. */
    hint: 'Filmed elsewhere and uploaded here. The Library is the only place it exists.',
  },
  {
    key: 'GENERATED',
    label: 'Generated in SiteComply',
    hint:
      'Produced from a Company Module. The module is the source of truth: edit the ' +
      'wording there and regenerate, so there is never a second version of the same ' +
      'content with nobody able to say which one an operative saw.',
  },
] as const;

export type LibraryProvenanceKey = (typeof LIBRARY_PROVENANCE)[number]['key'];

export function provenanceLabel(key: string): string {
  return LIBRARY_PROVENANCE.find((p) => p.key === key)?.label ?? key;
}
export function provenanceHint(key: string): string {
  return LIBRARY_PROVENANCE.find((p) => p.key === key)?.hint ?? '';
}

/**
 * MAY THIS ASSET'S CONTENT BE CHANGED IN THE LIBRARY?
 *
 * The one rule that makes the two provenances coherent, in one place so no surface
 * can forget it. Library metadata - title, category, placement, whether a site may
 * opt out - is always editable. The CONTENT of a generated asset is not: it belongs
 * to the module it was produced from.
 */
export function contentEditableHere(provenance: string): boolean {
  return provenance !== 'GENERATED';
}
