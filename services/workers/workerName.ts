/**
 * How an operative's display name is built, and how an old record is opened.
 *
 * ONE PLACE. The form, the save path and the tests all read these, so the rule
 * exists once rather than being re-derived slightly differently in three places.
 */

/**
 * The display name, from its parts.
 *
 * DERIVED, NEVER TYPED. `fullName` stays a stored column because roughly 200
 * places read it — reports, exports, close-out PDFs, induction signatures,
 * search and sort — including documents already issued and signed. Computing it
 * on save leaves every one of them correct and untouched.
 */
export function composeFullName(
  firstName: string | null | undefined,
  surname: string | null | undefined,
): string {
  return [firstName?.trim(), surname?.trim()].filter(Boolean).join(' ');
}

/**
 * What to put in the First name box when opening an existing record.
 *
 * THREE CASES, in order of how much we actually know:
 *
 *   1. firstName is stored      — use it. Nothing to infer.
 *   2. surname is stored AND fullName ends with it — the remainder is the first
 *      name. An EXACT SUFFIX match, never a word split: "Zhang Wei" does not end
 *      with "Zhang", so it is left alone rather than mangled.
 *   3. otherwise                — hand back the whole fullName for the worker to
 *      correct.
 *
 * Case 3 looks careless and is not. firstName is display only; it never reaches
 * Smart Check, which uses the surname the operative typed. So the worst outcome
 * is a name that reads as it already did, in an editable box, in front of the
 * person whose name it is. Contrast the surname, where a guess meant a failed
 * card check at a site gate — which is why that one is asked and never inferred.
 */
export function openingFirstName(worker: {
  firstName?: string | null;
  surname?: string | null;
  fullName?: string | null;
}): string {
  const surname = (worker.surname ?? '').trim();

  /*
   * A stored first name that ENDS WITH the stored surname is the signature of
   * the invite defect: an invitation stored only a full name, the form offered
   * all of it as the first name, and the operative then typed their surname
   * into the empty box - "Jordan Smith" + "Smith" composed "Jordan Smith Smith".
   * The same exact-suffix rule as case 2 opens it as "Jordan", in an editable
   * box, so the next save repairs the record instead of re-saving the repeat.
   */
  const stored = worker.firstName?.trim();
  if (stored) return stripTrailingSurname(stored, surname) ?? stored;

  const full = (worker.fullName ?? '').trim();
  if (!full) return '';

  return stripTrailingSurname(full, surname) ?? full;
}

/**
 * `name` minus a trailing ` surname`, or null when it does not end with one.
 * An EXACT whole-word suffix, case-insensitive - never a word split.
 */
function stripTrailingSurname(name: string, surname: string): string | null {
  if (!surname || name.length <= surname.length) return null;
  if (!name.toLowerCase().endsWith(` ${surname.toLowerCase()}`)) return null;
  return name.slice(0, name.length - surname.length).trim() || null;
}

/**
 * True when the First name box already ends with what is in the Surname box -
 * saving would repeat the surname in the display name. The form asks the
 * operative to confirm before saving that.
 */
export function firstNameRepeatsSurname(firstName: string, surname: string): boolean {
  return stripTrailingSurname(firstName.trim(), surname.trim()) !== null;
}

/**
 * Should the details form ask the operative to check how their name is split?
 *
 * Only where the record cannot say which part is the surname: no surname is
 * stored and the name that will be offered as the first name has more than one
 * word. That is every operative invited before invitations asked for the two
 * parts separately - their whole name sits in the First name box - and anyone
 * who later saved it that way. A notice, not a correction: "Mary Anne" with no
 * surname is a legitimate answer, and nothing here can tell it from "Jordan
 * Smith". The person whose name it is can.
 *
 * Also true when a repeated surname was just removed by openingFirstName, so the
 * operative is told why their first name box differs from what they saved.
 */
export function nameNeedsChecking(worker: {
  firstName?: string | null;
  surname?: string | null;
  fullName?: string | null;
}): boolean {
  const surname = (worker.surname ?? '').trim();
  const opening = openingFirstName(worker);
  if (!opening) return false;
  if (!surname) return /\s/.test(opening);
  const stored = worker.firstName?.trim();
  return Boolean(stored) && opening !== stored;
}
