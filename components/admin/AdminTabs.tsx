import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Tab strip for an Admin Centre workspace.
 *
 * A TEXT TAB ROW WITH AN ACTIVE INDICATOR — one shared rule running under all
 * of them, and the selected tab sitting on a thick brand indicator that breaks
 * that rule. No pill, no segmented container, no per-tab border, no fill.
 *
 * ── WHY IT IS BACK TO THIS ────────────────────────────────────────────────
 *
 * This strip has been through the alternatives. A flooded pill, a tinted pill
 * and a neutral surface chip were each rejected for the same reason: anything
 * with a filled shape reads as a button, and a row of buttons above a settings
 * page competes with the settings. The original underlined row never had that
 * problem — its only fault was that it was too quiet to look interactive.
 *
 * So this is the original pattern with the discoverability problem fixed
 * directly, rather than by reaching for a different pattern:
 *
 *   INDICATOR   3px rather than 2px, and it is the only saturated thing here,
 *               so the eye lands on it without anything being filled.
 *   TYPE        bold at full-strength ink for the active tab against medium
 *               muted for the rest — two steps apart, not one, because one was
 *               what made the original read as a list of links.
 *   HOVER       the indicator ANSWERS. Hovering an inactive tab draws a grey
 *               indicator in the place the brand one would go, which is the
 *               single clearest way to say "this is a tab you can select"
 *               without adding a background.
 *   SPACING     wider tabs on a taller row, so each one is a target rather
 *               than a word in a sentence.
 *
 * SELF-STYLED, NOT DELEGATED. An earlier pass rendered this through the
 * Platform's SegmentedNav to avoid two copies of one visual language. That was
 * the right instinct for a pill and the wrong one here: SegmentedNav IS a
 * segmented control, and this is deliberately not one. Sharing it again would
 * mean pushing an underline mode into a component whose whole job is filled
 * segments — and every Platform filter strip would be one prop away from
 * changing shape. They are different patterns and now say so.
 *
 * Still a SERVER component. The page reads the tab from its own searchParams,
 * so nothing here needs the browser.
 *
 * TABS ARE ADDRESSES, NOT LOCAL STATE. Each carries a query parameter, so a tab
 * can be linked to, bookmarked and reloaded, and an error message elsewhere can
 * point at the right one. Unchanged through every pass — only the paint moved.
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
    <nav
      aria-label={label}
      // The rule is on the ROW, so it runs the full width behind every tab and
      // the indicator reads as breaking it rather than as a stray underline.
      className="mt-5 flex gap-1 overflow-x-auto border-b border-line"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`${basePath}?${param}=${tab.key}`}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              // -mb-px lifts the indicator onto the row's rule so the two are
              // one line, not two stacked ones.
              '-mb-px whitespace-nowrap border-b-[3px] px-5 py-3.5 text-sm transition-colors',
              isActive
                ? 'border-brand-500 font-bold text-ink'
                : 'border-transparent font-medium text-ink-muted hover:border-ink-subtle hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
