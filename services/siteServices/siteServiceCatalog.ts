/**
 * SC-021 Phase 1 — the site services catalogue, DATA AND PURE HELPERS ONLY.
 *
 * Kept free of Prisma/server imports (mirrors dashboardPanels.ts) so the
 * configuration UI, the wizard step and the server-side enforcement all work
 * from ONE definition of what a "site service" is and how defaults behave.
 *
 * THE DEFAULT IS AVAILABLE. Storage holds overrides only, so a site that has
 * never been configured behaves exactly as it did before SC-021 existed. That
 * is what makes this deployable with no backfill and no regression: turning
 * something off is always a deliberate act, recorded against a named person.
 */

/** The two catalogues a site can switch things off in. */
export type SiteServiceKind = 'PERMIT_TYPE' | 'ACTIVITY_TYPE';

export const SITE_SERVICE_KINDS: SiteServiceKind[] = [
  'PERMIT_TYPE',
  'ACTIVITY_TYPE',
];

export function isSiteServiceKind(v: unknown): v is SiteServiceKind {
  return v === 'PERMIT_TYPE' || v === 'ACTIVITY_TYPE';
}

export const SITE_SERVICE_KIND_META: Record<
  SiteServiceKind,
  { title: string; description: string; singular: string }
> = {
  PERMIT_TYPE: {
    title: 'Permits',
    singular: 'permit type',
    description:
      'Which permits to work this site’s workers can request. Turning one off removes it from the worker’s permit picker.',
  },
  ACTIVITY_TYPE: {
    title: 'Inspections and checks',
    singular: 'inspection type',
    description:
      'Which inspections, checks and audit formats apply to this site. Turning one off removes it from new audits and from the compliance scheduler.',
  },
};

/** One row in the configuration UI. */
export interface SiteServiceItem {
  id: string;
  name: string;
  description: string | null;
  /** Effective availability = default (true) overlaid with any stored override. */
  enabled: boolean;
  /** True when this site has an explicit stored override for the item. */
  configured: boolean;
  /**
   * Active compliance schedules on this site using the item. Non-empty means
   * disabling is BLOCKED — see `disableBlockedReason`.
   */
  blockingSchedules: string[];
  /**
   * Work already in progress that a disable would NOT stop. Not a blocker: the
   * SC-021 rule is that disabling governs new work only, so anything already
   * raised runs to completion. Surfaced so the manager isn't surprised.
   */
  inFlightCount: number;
}

export interface SiteServiceGroup {
  kind: SiteServiceKind;
  items: SiteServiceItem[];
}

/**
 * Why a disable is refused, phrased for the person doing it.
 *
 * Deliberately names the schedules rather than saying "in use". A manager who is
 * told only that something is in use has to go hunting; a manager who is told
 * which schedules to deal with can act. Auto-deactivating those schedules was
 * the alternative and is far worse — scheduled inspections would silently stop
 * generating, which is the exact failure SC-020 Phase 4 was built to prevent.
 */
export function disableBlockedReason(
  itemName: string,
  scheduleTitles: string[],
): string {
  if (scheduleTitles.length === 0) return '';
  const list = scheduleTitles.join(', ');
  return scheduleTitles.length === 1
    ? `“${itemName}” cannot be turned off while the schedule “${list}” is still active on this site. Deactivate that schedule first, then turn the type off.`
    : `“${itemName}” cannot be turned off while ${scheduleTitles.length} active schedules still use it on this site (${list}). Deactivate them first, then turn the type off.`;
}

/** The reassurance shown when work is already in progress but isn't a blocker. */
export function inFlightNotice(kind: SiteServiceKind, count: number): string {
  if (count <= 0) return '';
  const noun = count === 1 ? 'permit' : 'permits';
  return kind === 'PERMIT_TYPE'
    ? `${count} ${noun} of this type ${count === 1 ? 'is' : 'are'} still going through approval. ${count === 1 ? 'It' : 'They'} will continue as normal — turning the type off only stops NEW requests.`
    : `${count} activit${count === 1 ? 'y is' : 'ies are'} already scheduled and will still be completed. Turning the type off only stops new ones.`;
}
