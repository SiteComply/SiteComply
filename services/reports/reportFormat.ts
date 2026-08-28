/**
 * Shared rendering for report figures that can legitimately be "no data".
 *
 * A percentage over an empty population is not 0% — it is unknown. Reporting it
 * as 0 makes a site with no check-ins in the period look identical to a site
 * where every check-in failed, which is the opposite conclusion. These helpers
 * exist so the screen and the CSV agree on how that is shown, rather than each
 * page inventing its own dash.
 */

/** On screen: "72%", or an em dash when there is nothing to measure. */
export function percentLabel(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

/**
 * In a CSV: an EMPTY cell, not "0" and not "—".
 *
 * A blank reads as "no value" in Excel and stays out of AVERAGE and SUM, so a
 * spreadsheet built on the export cannot quietly average a missing site in as a
 * zero. A literal dash would turn the whole column into text.
 */
export function percentCell(value: number | null): string {
  return value === null ? '' : String(value);
}
