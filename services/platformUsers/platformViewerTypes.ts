import type { PermissionOverride } from '@/services/platformUsers/contractorAccessConstants';
import type { SiteOverrides } from '@/services/platformUsers/contractorAccessConstants';
import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';

/**
 * The viewer shape, kept separate from platformAccess.ts.
 *
 * platformAccess wraps the session viewer in React's `cache()`, which exists
 * only inside a request. Anything that merely needs the TYPES — or needs to
 * build a viewer outside a request, as SC-024 Phase 3's share links do — imports
 * from here instead and stays usable in scripts and tests.
 */

export interface ViewerSite {
  id: string;
  name: string;
  jobReference: string;
  town: string;
  postcode: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface PlatformViewer {
  id: string;
  name: string;
  company: string;
  role: PlatformRoleValue;
  /** True for Director — sees all sites and ignores Assigned Sites. */
  allSites: boolean;
  /** Ids of every site the viewer may see (the access boundary). */
  siteIds: string[];
  /** The sites the viewer may see, for listing. */
  sites: ViewerSite[];
  /**
   * SC-022 — per-site permission overrides NARROWING the role baseline.
   * Keyed siteId → module → retained verbs. Only overridden entries appear;
   * absence means the role baseline applies unchanged.
   */
  overrides: SiteOverrides;
  /** SC-022 Phase 2 — the company-wide floor applying to this user. */
  companyDefaults: PermissionOverride;
}

/** The site columns a viewer carries. */
export const SITE_FIELDS = {
  id: true,
  name: true,
  jobReference: true,
  town: true,
  postcode: true,
  status: true,
} as const;

export type { SiteOverrides };
