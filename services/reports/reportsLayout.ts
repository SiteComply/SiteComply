/**
 * Which layout the Reports landing renders.
 *
 * `catalogue` — the adopted design. Reports are functional destinations, not
 *               dashboard content: a directory row carries the name, what the
 *               report answers, its scope and an action, and thirteen of them
 *               scan in a fraction of the height.
 *
 * `cards`     — the previous 3-column grid of equal-weight widgets, retained
 *               verbatim and reachable by setting REPORTS_LAYOUT=cards on the
 *               App Service. Restoring it is one setting and a restart, with
 *               no redeploy — the same escape hatch CLOSE_OUT_NARRATIVE_MODE
 *               provides for the close-out narrative.
 *
 * An unset or unrecognised value yields `catalogue`. Deliberate: the default
 * should be the design in use, so a typo degrades to the current product
 * rather than silently reviving the old one.
 */
export type ReportsLayout = 'catalogue' | 'cards';

/** Env var name, exported so the deploy guard and docs cannot drift from it. */
export const REPORTS_LAYOUT_ENV = 'REPORTS_LAYOUT';

export function getReportsLayout(): ReportsLayout {
  return process.env[REPORTS_LAYOUT_ENV]?.trim().toLowerCase() === 'cards'
    ? 'cards'
    : 'catalogue';
}
