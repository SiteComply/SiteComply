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
 * The Site Information sections, in display order. This drives the completeness
 * indicator INSIDE the Site Information panel, so it deliberately covers only
 * that panel's own fields.
 *
 * The emergency fields live on the site record and are counted separately by
 * SITE_EMERGENCY_SECTIONS — see the note there for why the two are kept apart.
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

/**
 * The emergency sections a worker sees on Worker → Emergency info. Stored on the
 * JobSite record rather than SiteInformation, which is why they were historically
 * excluded from every completeness figure — a site could report all worker-facing
 * sections complete while the Emergency page said nothing had been recorded.
 *
 * "First aider" is one section covering three fields; it counts as present when a
 * NAME is recorded, matching the worker page, which keys the whole block off the
 * name and treats location and number as optional detail.
 */
export const SITE_EMERGENCY_SECTIONS = [
  { key: 'fireAssemblyPoint', label: 'Fire assembly point' },
  { key: 'firstAider', label: 'First aider' },
  { key: 'nearestHospital', label: 'Nearest A&E' },
  { key: 'emergencyNumber', label: 'Emergency number' },
] as const;

export type SiteEmergencySectionKey =
  (typeof SITE_EMERGENCY_SECTIONS)[number]['key'];
