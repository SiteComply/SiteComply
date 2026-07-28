/**
 * Client-safe Site Information constants (SC-008). Shared by the manager admin
 * panel (client) and the service/validation (server) so field limits, the
 * accepted site-map formats and the completeness definition never drift.
 *
 * Kept free of Prisma/server imports.
 */

/** Max lengths for the free-text fields (line breaks preserved on render). */
export const WORKING_HOURS_MAX = 500;
export const SITE_TEXT_MAX = 5000; // site rules / welfare / hazards / procedures

/** Site-map image: reuse the Documents module's 20 MB cap. */
export const SITE_MAP_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Accepted site-map upload types — browser-renderable images only, so a worker
 * can view the map inline on their phone. (A subset of the Documents module's
 * accepted types; HEIC is excluded because browsers can't render it inline.)
 */
export const SITE_MAP_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const SITE_MAP_ACCEPT_HINT = 'JPG, PNG or WebP image — up to 20 MB.';

/**
 * The manager-owned Site Information sections, in display order, used for the
 * completeness indicator. Emergency fields (fire assembly, first aider, A&E,
 * emergency number) are NOT here — they are managed on the site record and only
 * shown read-only, so they don't count toward this panel's completeness.
 */
export const SITE_INFO_SECTIONS = [
  { key: 'workingHours', label: 'Working hours' },
  { key: 'siteRules', label: 'Site rules' },
  { key: 'welfareFacilities', label: 'Welfare facilities' },
  { key: 'siteHazards', label: 'Site-specific hazards' },
  { key: 'emergencyProcedures', label: 'Emergency procedures' },
  { key: 'siteMap', label: 'Site map' },
] as const;

export type SiteInfoSectionKey = (typeof SITE_INFO_SECTIONS)[number]['key'];
