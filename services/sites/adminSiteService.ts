import { SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normaliseUkPostcode } from '@/lib/postcode';
import { UK_INDUCTION_TEMPLATE } from '@/services/checklists/ukInductionTemplate';

/**
 * Admin-side job site management (create / edit / archive).
 *
 * Validation lives here so the API and any future caller share one source of
 * truth. Creating a site also seeds a default UK induction checklist (v1) so the
 * site is immediately usable by workers; admins refine it in the Stage 9 builder.
 */

export interface SiteInput {
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  town?: string;
  postcode?: string;
  jobReference?: string;
  inductionContent?: string;
  fireAssemblyPoint?: string;
  firstAiderName?: string;
  firstAiderNumber?: string;
}

export interface ValidatedSite {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  town: string;
  postcode: string;
  jobReference: string;
  inductionContent: string;
  fireAssemblyPoint: string | null;
  firstAiderName: string | null;
  firstAiderNumber: string | null;
}

export type FieldErrors = Partial<Record<keyof SiteInput, string>>;

/** Validate & normalise site input. Returns either field errors or clean data. */
export function validateSite(
  input: SiteInput,
): { ok: true; value: ValidatedSite } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const text = (v?: string) => (v ?? '').trim();

  const name = text(input.name);
  const addressLine1 = text(input.addressLine1);
  const town = text(input.town);
  const jobReference = text(input.jobReference);

  if (name.length < 2) errors.name = 'Please enter the site name.';
  if (addressLine1.length < 2)
    errors.addressLine1 = 'Please enter the first line of the address.';
  if (town.length < 2) errors.town = 'Please enter the town or city.';
  if (jobReference.length < 1)
    errors.jobReference = 'Please enter a job reference.';

  const postcode = normaliseUkPostcode(input.postcode ?? '');
  if (!postcode.ok) errors.postcode = postcode.error;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      addressLine1,
      addressLine2: text(input.addressLine2) || null,
      town,
      postcode: postcode.postcode!,
      jobReference,
      inductionContent: text(input.inductionContent),
      fireAssemblyPoint: text(input.fireAssemblyPoint) || null,
      firstAiderName: text(input.firstAiderName) || null,
      firstAiderNumber: text(input.firstAiderNumber) || null,
    },
  };
}

/** All sites for the admin list, with a checked-in (on site now) count. */
export async function listSitesForAdmin() {
  const sites = await prisma.jobSite.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      _count: {
        select: { submissions: { where: { checkedOutAt: null } } },
      },
    },
  });
  return sites.map((s) => ({ ...s, onSiteCount: s._count.submissions }));
}

export function getSiteById(id: string) {
  return prisma.jobSite.findUnique({ where: { id } });
}

export async function createSite(value: ValidatedSite, adminId: string) {
  return prisma.jobSite.create({
    data: {
      ...value,
      createdByAdminId: adminId,
      status: SiteStatus.ACTIVE,
      // Seed a default UK induction checklist so workers can induct immediately.
      checklists: {
        create: {
          title: 'Site induction & compliance checklist',
          version: 1,
          items: {
            create: UK_INDUCTION_TEMPLATE.map((item, index) => ({
              label: item.label,
              helpText: item.helpText,
              type: item.type,
              required: item.required,
              order: index,
            })),
          },
        },
      },
    },
  });
}

export function updateSite(id: string, value: ValidatedSite) {
  return prisma.jobSite.update({ where: { id }, data: value });
}

export function setSiteStatus(id: string, status: SiteStatus) {
  return prisma.jobSite.update({ where: { id }, data: { status } });
}
