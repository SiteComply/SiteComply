import { SegmentedNav } from '@/components/platform/navUi';

/**
 * Tab strip for an Admin Centre workspace.
 *
 * RENDERS THROUGH SegmentedNav rather than styling itself. The first version
 * was an underlined strip of its own, and it read as three text links with a
 * rule under one of them — a heading, not a control. SegmentedNav is the
 * pattern the Platform already uses for exactly this job (filter strips on
 * Actions, Permits, Sites and Check-ins): a bounded container with the active
 * item as a solid filled pill, which is unmistakably a selectable thing.
 *
 * Delegating instead of copying its classes is the same reasoning that has
 * SettingsWorkspace render through SectionWorkspace and Section through Panel —
 * two hand-maintained copies of one visual language drift the moment either is
 * touched, and this is the second portal, which is precisely when that starts.
 *
 * `size="md"` is used because this is a workspace's PRIMARY navigation rather
 * than a filter above a list: a bigger target, and enough presence to read as
 * the thing you steer the page with.
 *
 * `tone="subtle"` because a filled brand swatch reads as a primary action
 * wherever it appears. The first pass flooded the active tab, the second
 * tinted it, and both landed in the same place: the eye files a coloured pill
 * with the Save button rather than with the navigation. The subtle tone drops
 * colour from the selected state altogether and carries it on surface, a
 * hairline boundary and type weight instead.
 *
 * Target size, padding and gaps are all unchanged across every pass — the
 * 52px target from the first one is deliberately kept, and the boundary is an
 * inset ring precisely because a border would have moved things.
 *
 * Still a SERVER component. The page reads the tab from its own searchParams,
 * so nothing here needs the browser.
 *
 * TABS ARE ADDRESSES, NOT LOCAL STATE. Each carries a query parameter, so a tab
 * can be linked to, bookmarked and reloaded, and an error message elsewhere can
 * point at the right one. Unchanged by this pass — only the appearance moved.
 */
export interface AdminTab {
  key: string;
  label: string;
}

export function AdminTabs({
  tabs,
  active,
  basePath,
  param = 'tab',
  label,
}: {
  tabs: AdminTab[];
  active: string;
  basePath: string;
  param?: string;
  /** Accessible name for the navigation landmark. */
  label: string;
}) {
  return (
    <SegmentedNav
      label={label}
      size="md"
      tone="subtle"
      // mt-4 replaces SegmentedNav's own mb-4: the strip sits under the page
      // description and above the panels, so the space belongs above it here.
      className="mt-4 mb-0"
      items={tabs.map((tab) => ({
        key: tab.key,
        label: tab.label,
        href: `${basePath}?${param}=${tab.key}`,
        active: tab.key === active,
      }))}
    />
  );
}
