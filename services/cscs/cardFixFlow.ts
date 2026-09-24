/**
 * Sending an operative back to their card details after a failed check.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────────
 *
 * The remediation banner ("We could not find your CSCS card") offered "Check my
 * card details", linking to /check-in/details. That page begins by sending a
 * worker who is ALREADY CHECKED IN to their dashboard - a sensible guard, since
 * a checked-in worker has nothing to answer in the check-in flow.
 *
 * But the banner only ever appears on the worker dashboard, which only exists
 * for a checked-in worker. So every single person who could press that button
 * was bounced straight back to the page they pressed it on. Nothing looked
 * broken; nothing appeared to happen at all. Ryan reported exactly that.
 *
 * Two pieces of code each behaved correctly and the journey between them did
 * not. So the link and the rule that honours it now live HERE, in one file:
 * the banner cannot point somewhere the page does not expect, and the page
 * cannot stop honouring what the banner sends.
 *
 * ── FIXING A CARD IS NOT CHECKING IN ──────────────────────────────────────
 *
 * A worker arriving this way is already on site. They are not walking the
 * check-in journey, so the screen does not number them through it and does not
 * push them towards choosing a site afterwards - it returns them to where they
 * pressed the button.
 */

/** The query that marks an arrival as "I have come to fix my card". */
export const CARD_FIX_PARAM = 'fix';
export const CARD_FIX_VALUE = 'cscs';

/** The one link. Imported by the banner; honoured by the details page. */
export const CARD_FIX_HREF = `/check-in/details?${CARD_FIX_PARAM}=${CARD_FIX_VALUE}`;

/** Where a worker who came to fix a card is returned to afterwards. */
export const CARD_FIX_RETURN = '/worker/dashboard';

/** Did this request arrive from the card-remediation prompt? */
export function isCardFixRequest(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): boolean {
  const raw = searchParams?.[CARD_FIX_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === CARD_FIX_VALUE;
}

/**
 * Should the details screen bounce this worker to their dashboard?
 *
 * Yes when they are checked in and simply arrived at the check-in flow by a
 * back button or a stale tab - there is nothing there for them to answer.
 * NO when they were sent to fix their card: that is the whole point of the
 * journey, and bouncing them is the bug this module is named after.
 */
export function shouldLeaveCheckInDetails(
  hasOpenCheckIn: boolean,
  fixingCard: boolean,
): boolean {
  return hasOpenCheckIn && !fixingCard;
}
