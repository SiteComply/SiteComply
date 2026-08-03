import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  CONTACT_ROLE_MAX,
  CONTACT_NAME_MAX,
  CONTACT_PHONE_MAX,
} from '@/services/sites/siteContactConstants';

/**
 * Site contacts (SC-003) — the named people and numbers a checked-in worker may
 * need to call, shown on the Worker Dashboard's Site Contacts panel.
 *
 * Managed by any role holding the `sites` "edit" permission for a site in its
 * scope (site managers included — this is day-to-day site content, unlike the
 * Director-only site record itself). The site boundary is enforced here as
 * defence in depth; routes check the same permission before calling.
 */

export {
  CONTACT_ROLE_MAX,
  CONTACT_NAME_MAX,
  CONTACT_PHONE_MAX,
} from '@/services/sites/siteContactConstants';

export interface SiteContactInput {
  role?: string;
  name?: string;
  phone?: string;
}

export interface SiteContactRecord {
  id: string;
  role: string;
  name: string | null;
  phone: string | null;
  order: number;
}

export type SiteContactFieldErrors = Partial<
  Record<keyof SiteContactInput, string>
>;

/** Validate & normalise a contact. A role is required; name and phone optional. */
export function validateSiteContact(input: SiteContactInput):
  | {
      ok: true;
      value: { role: string; name: string | null; phone: string | null };
    }
  | { ok: false; errors: SiteContactFieldErrors } {
  const errors: SiteContactFieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const role = text(input.role);
  const name = text(input.name);
  const phone = text(input.phone);

  if (role.length < 2) errors.role = 'Please enter the contact’s role.';
  else if (role.length > CONTACT_ROLE_MAX)
    errors.role = `Please keep the role under ${CONTACT_ROLE_MAX} characters.`;

  if (name.length > CONTACT_NAME_MAX)
    errors.name = `Please keep the name under ${CONTACT_NAME_MAX} characters.`;

  if (phone.length > CONTACT_PHONE_MAX)
    errors.phone = `Please keep the number under ${CONTACT_PHONE_MAX} characters.`;

  // A contact nobody can reach and nobody is named for helps no one.
  if (!name && !phone) errors.name = 'Please enter a name or a contact number.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { role, name: name || null, phone: phone || null },
  };
}

/**
 * A site's contacts in display order. Not viewer-scoped — used by both the
 * worker dashboard (access proven by an open check-in) and, via the scoped
 * wrapper below, by the management UI.
 */
export function listSiteContacts(siteId: string): Promise<SiteContactRecord[]> {
  return prisma.siteContact.findMany({
    where: { jobSiteId: siteId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, role: true, name: true, phone: true, order: true },
  });
}

/** A site's contacts for a platform viewer, enforcing the site boundary. */
export async function listSiteContactsForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<SiteContactRecord[]> {
  if (!viewer.siteIds.includes(siteId)) return [];
  return listSiteContacts(siteId);
}

export type SiteContactResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'validation'; errors: SiteContactFieldErrors };

/** Add a contact to a site. New contacts sort to the end of the list. */
export async function createSiteContact(
  viewer: PlatformViewer,
  siteId: string,
  input: SiteContactInput,
): Promise<SiteContactResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const validated = validateSiteContact(input);
  if (!validated.ok) {
    return { ok: false, reason: 'validation', errors: validated.errors };
  }

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  const last = await prisma.siteContact.findFirst({
    where: { jobSiteId: siteId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });

  const created = await prisma.siteContact.create({
    data: {
      jobSiteId: siteId,
      ...validated.value,
      order: (last?.order ?? -1) + 1,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

/** Update a contact, re-checking the permission and the site boundary. */
export async function updateSiteContact(
  viewer: PlatformViewer,
  contactId: string,
  input: SiteContactInput,
): Promise<SiteContactResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }

  const existing = await prisma.siteContact.findFirst({
    where: { id: contactId, jobSiteId: { in: viewer.siteIds } },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  const validated = validateSiteContact(input);
  if (!validated.ok) {
    return { ok: false, reason: 'validation', errors: validated.errors };
  }

  await prisma.siteContact.update({
    where: { id: contactId },
    data: validated.value,
  });
  return { ok: true, id: contactId };
}

/** Remove a contact. Returns false when it isn't in the viewer's scope. */
export async function deleteSiteContact(
  viewer: PlatformViewer,
  contactId: string,
): Promise<boolean> {
  if (!permits(viewer.role, 'sites', 'edit')) return false;

  const existing = await prisma.siteContact.findFirst({
    where: { id: contactId, jobSiteId: { in: viewer.siteIds } },
    select: { id: true },
  });
  if (!existing) return false;

  await prisma.siteContact.delete({ where: { id: contactId } });
  return true;
}
