/**
 * Site rules — the pure shapes and the editor's row logic.
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────
 *
 * Because the Site rules EDITOR is a client component and this code has to
 * cross that boundary. `siteRulesService` imports `adminChecklistService`,
 * which imports `lib/prisma`, which reaches `node:async_hooks` — so a client
 * component that imports a VALUE from the service pulls the whole server chain
 * into the browser bundle and the build fails outright.
 *
 * It is a trap worth naming, because it is invisible to the type checker: the
 * component imported `SiteRule` from the service for weeks without trouble,
 * since a `import type` is erased at compile time and never reaches webpack.
 * Changing one type import to a value import is what broke it. `tsc --noEmit`
 * passed; the build did not.
 *
 * So: nothing here may import anything that touches Prisma, the filesystem or
 * any other server-only API. Types and pure functions only. `siteRulesService`
 * re-exports the lot, so server-side callers need not know this file exists.
 */

export interface SiteRule {
  label: string;
  helpText: string | null;
}

/** A library entry, plus which tier it belongs to. */
export interface LibraryRule extends SiteRule {
  /** Seeded onto a new site. False for an optional site-specific template. */
  defaultSelected: boolean;
}

/**
 * A row in the Site rules editor: what a Site Manager actually sees.
 *
 * Lives here, not inside the component, so the decision "which rules appear,
 * ticked or unticked, badged how" can be tested without a browser. The component
 * around it is a checkbox, a label and two arrows; this is the part that can be
 * wrong.
 */
export interface RuleRow {
  label: string;
  helpText: string | null;
  /** Shown at induction. An unticked row is not deleted — it can be ticked back. */
  selected: boolean;
  /** Typed for this site rather than drawn from the library. */
  custom: boolean;
  /** A library rule NOT seeded by default — adopted only where it applies. */
  optional: boolean;
}

/**
 * Build the editor's rows from the library and whatever this site has saved.
 *
 * Every library rule appears whether or not the site uses it: the optional
 * templates are the unticked ones, and an unticked default is one this site has
 * chosen to drop. Rules the site has saved that match nothing in the library are
 * its own, and come last.
 */
export function buildRuleRows(
  current: SiteRule[],
  library: LibraryRule[],
): RuleRow[] {
  const byLabel = new Map(current.map((r) => [r.label.trim().toLowerCase(), r]));
  const libraryRows: RuleRow[] = library.map((r) => {
    const live = byLabel.get(r.label.trim().toLowerCase());
    return {
      label: r.label,
      // A site that edited the help text in the checklist builder keeps its
      // wording; only the selection state comes from whether the row exists.
      helpText: live ? live.helpText : r.helpText,
      selected: Boolean(live),
      custom: false,
      optional: !r.defaultSelected,
    };
  });
  const libraryLabels = new Set(
    library.map((r) => r.label.trim().toLowerCase()),
  );
  const customRows: RuleRow[] = current
    .filter((r) => !libraryLabels.has(r.label.trim().toLowerCase()))
    .map((r) => ({
      label: r.label,
      helpText: r.helpText,
      selected: true,
      custom: true,
      optional: false,
    }));
  return [...libraryRows, ...customRows];
}
