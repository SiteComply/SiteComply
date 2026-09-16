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
  const stored = worker.firstName?.trim();
  if (stored) return stored;

  const full = (worker.fullName ?? '').trim();
  const surname = (worker.surname ?? '').trim();
  if (!full) return '';

  if (surname && full.length > surname.length) {
    const lower = full.toLowerCase();
    if (lower.endsWith(` ${surname.toLowerCase()}`)) {
      return full.slice(0, full.length - surname.length).trim();
    }
  }

  return full;
}
