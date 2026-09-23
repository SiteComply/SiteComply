/**
 * Which documents an operative may see.
 *
 * ONE RULE, ONE PLACE. The RAMS page, the dashboard count and the induction
 * briefing all asked the same question three times - "every document on this
 * site" - and each would have to be narrowed identically. They now call this,
 * so they cannot drift apart: a document an operative can open in the induction
 * is exactly one they can open afterwards.
 *
 * THE RULE
 *
 *   site-wide (no company)          → everyone on the project sees it
 *   owned by the operative's company → they see it
 *   owned by another company         → they do not
 *
 * NO COMPANY ON THE ASSIGNMENT means site-wide documents ONLY. That is the
 * safe direction and the owner's decision: showing an operative another
 * contractor's method statement is the complaint this exists to answer, and a
 * missing company is a gap a manager can see and fill (the roster flags it).
 *
 * COMPANY COMES FROM THE ASSIGNMENT, never from the operative's own typed
 * company. An operative editing their employer on their details screen must not
 * be able to change which safety documents reach them.
 */

/** A Prisma `where` fragment: site-wide, plus this company's if there is one. */
export function documentCompanyWhere(
  siteCompanyId: string | null | undefined,
): { siteCompanyId: null } | { OR: [{ siteCompanyId: null }, { siteCompanyId: string }] } {
  const id = (siteCompanyId ?? '').trim();
  return id
    ? { OR: [{ siteCompanyId: null }, { siteCompanyId: id }] }
    : { siteCompanyId: null };
}

/** The same rule in memory, for a document already loaded. */
export function documentIsVisibleTo(
  document: { siteCompanyId?: string | null },
  siteCompanyId: string | null | undefined,
): boolean {
  const owner = (document.siteCompanyId ?? '').trim();
  if (!owner) return true;
  return owner === (siteCompanyId ?? '').trim();
}

/**
 * What to tell an operative about the list they are looking at, so a short list
 * is not mistaken for a missing one.
 */
export function documentScopeNote(companyName: string | null | undefined): string {
  const name = (companyName ?? '').trim();
  return name
    ? `Documents for ${name}, and documents that apply to everyone on this site.`
    : 'Documents that apply to everyone on this site. Ask your site manager to record your company if you are expecting your employer’s documents.';
}
